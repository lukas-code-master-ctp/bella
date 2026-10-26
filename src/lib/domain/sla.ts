import type { MessageAuthor, Prisma } from "@prisma/client";
import { db } from "../db";
import { deliverPendingPush } from "../push";
import { getSetting, setSetting } from "../settings";
import { withinBusinessHours, type WeeklyHours } from "./ai-operation";
import { formatDuration } from "./metrics";
import { reassignTx } from "./assignment";
import { notifySlaLateTx } from "./notifications";

/**
 * SLA de ejecutivos: cuánto tarda el equipo en responderle al cliente cuando el lead lo atiende un
 * humano (la IA está pausada o el lead está en una etapa de atención humana). Se calcula sobre la
 * historia del lead (mensajes y eventos), sin guardar nada aparte, así que también vale para los
 * leads anteriores a esta función.
 *
 * Cada espera empieza:
 * - "first": cuando el lead pasa a un humano porque lo derivó la IA o una regla, o porque entró
 *   directo a una etapa de atención humana. Aunque el cliente no haya vuelto a escribir, alguien
 *   le prometió un ejecutivo.
 * - "reply": cuando el cliente escribe en un lead que ya atiende un humano (o cuando una persona
 *   lo pasa a humano a mano y el cliente esperaba respuesta).
 * Termina con el siguiente mensaje de una persona del equipo. Si el lead vuelve a la IA o se
 * cierra antes, la espera se descarta.
 */
export type SlaSettings = WeeklyHours & {
  /** Meta para la primera respuesta tras pasar a un humano, en minutos. */
  firstMinutes: number;
  /** Meta para responder cada mensaje del cliente después, en minutos. */
  replyMinutes: number;
  /** Avisar al ejecutivo (o a los admins si el lead no tiene) cuando una espera pasa la meta. */
  alerts: boolean;
  /** Avisar también a los admins cuando la espera llega al doble de la meta. */
  escalate: boolean;
  /** Pasar el lead a otro ejecutivo si no da la primera respuesta en `reassignMinutes` (apagado por defecto). */
  reassign: boolean;
  reassignMinutes: number;
};

export const DEFAULT_SLA: SlaSettings = {
  firstMinutes: 15,
  replyMinutes: 30,
  alerts: true,
  escalate: true,
  reassign: false,
  reassignMinutes: 60,
  hoursEnabled: true,
  days: [1, 2, 3, 4, 5],
  from: 9,
  to: 19,
};

export async function getSlaSettings(): Promise<SlaSettings> {
  return { ...DEFAULT_SLA, ...(await getSetting<Partial<SlaSettings>>("sla", {})) };
}

export async function saveSlaSettings(s: Partial<SlaSettings>) {
  await setSetting("sla", { ...(await getSlaSettings()), ...s });
}

export type WaitKind = "first" | "reply";

export const goalMs = (s: SlaSettings, kind: WaitKind) => (kind === "first" ? s.firstMinutes : s.replyMinutes) * 60_000;

const HOUR_MS = 3_600_000;
/** Una espera más larga que esto se mide solo en sus últimos días (ya está fuera de toda meta). */
const MAX_SPAN_MS = 60 * 24 * HOUR_MS;

/**
 * Tiempo entre dos instantes que cae dentro del horario laboral. Chile cambia de hora en horas
 * completas, así que basta revisar el horario hora por hora.
 */
export function businessMs(s: WeeklyHours, start: Date, end: Date): number {
  const to = end.getTime();
  if (!s.hoursEnabled) return Math.max(0, to - start.getTime());
  let t = Math.max(start.getTime(), to - MAX_SPAN_MS);
  let total = 0;
  while (t < to) {
    const next = Math.min(to, (Math.floor(t / HOUR_MS) + 1) * HOUR_MS);
    if (withinBusinessHours(s, new Date(t))) total += next - t;
    t = next;
  }
  return total;
}

export type Wait = {
  leadId: string;
  kind: WaitKind;
  startedAt: Date;
  /** Primer mensaje del equipo que la respondió; null si sigue esperando. */
  answeredAt: Date | null;
  /**
   * Se le quitó el lead al ejecutivo sin que respondiera (a mano o por la reasignación automática):
   * cuenta como fuera de meta para él, y para el nuevo ejecutivo empieza otra espera.
   */
  reassignedAt: Date | null;
  /** El ejecutivo a cargo cuando se respondió o reasignó (o ahora, si sigue esperando). */
  assigneeId: string | null;
};

export type LeadHistory = {
  id: string;
  status: string;
  assigneeId: string | null;
  events: { type: string; actor: string; userId?: string | null; data: unknown; createdAt: Date }[];
  messages: { author: MessageAuthor; userId: string | null; createdAt: Date }[];
};

/** Eventos que cambian quién atiende el lead o quién es su ejecutivo. */
export const SLA_EVENTS = ["CREATED", "STAGE_CHANGED", "AI_PAUSED", "AI_RESUMED", "ASSIGNED", "UNASSIGNED", "NO_REPLY_NEEDED"];

/** Recorre la historia de un lead y devuelve sus esperas. `humanStages`: nombres de las etapas de atención humana. */
export function waitsOf(lead: LeadHistory, humanStages: Set<string>): Wait[] {
  type Item =
    | { at: Date; order: 0; event: LeadHistory["events"][number] }
    | { at: Date; order: 1; message: LeadHistory["messages"][number] };
  const items: Item[] = [
    ...lead.events.map((event) => ({ at: event.createdAt, order: 0 as const, event })),
    ...lead.messages.map((message) => ({ at: message.createdAt, order: 1 as const, message })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime() || a.order - b.order);

  const waits: Wait[] = [];
  let aiEnabled = true;
  let inHumanStage = false;
  let assigneeId: string | null = null;
  let open: { kind: WaitKind; startedAt: Date } | null = null;
  // Si el último mensaje fue del cliente (esperaba respuesta de alguien).
  let contactPending = false;

  for (const item of items) {
    if (item.order === 1) {
      const m = item.message;
      if (m.author === "CONTACT") {
        contactPending = true;
        if (!aiEnabled || inHumanStage) open ??= { kind: "reply", startedAt: m.createdAt };
      } else {
        contactPending = false;
        if (m.author === "USER" && open) {
          waits.push({ leadId: lead.id, ...open, answeredAt: m.createdAt, reassignedAt: null, assigneeId: assigneeId ?? m.userId });
          open = null;
        }
      }
      continue;
    }
    const e = item.event;
    const data = (e.data ?? {}) as { stage?: string; to?: string; assigneeId?: string };
    if (e.type === "NO_REPLY_NEEDED") {
      // Un ejecutivo marcó que el mensaje del cliente no requiere respuesta (ej. "gracias, saludos"):
      // cuenta como atendido en ese momento.
      if (open) waits.push({ leadId: lead.id, ...open, answeredAt: e.createdAt, reassignedAt: null, assigneeId: assigneeId ?? e.userId ?? null });
      open = null;
      contactPending = false;
      continue;
    }
    const wasHuman = !aiEnabled || inHumanStage;
    if (e.type === "ASSIGNED") {
      const next: string | null = data.assigneeId ?? assigneeId;
      if (open && assigneeId && next !== assigneeId) {
        waits.push({ leadId: lead.id, ...open, answeredAt: null, reassignedAt: e.createdAt, assigneeId });
        open = { kind: open.kind, startedAt: e.createdAt };
      }
      assigneeId = next;
    }
    else if (e.type === "UNASSIGNED") assigneeId = null;
    else if (e.type === "AI_PAUSED") aiEnabled = false;
    else if (e.type === "AI_RESUMED") aiEnabled = true;
    else if (e.type === "CREATED" || e.type === "STAGE_CHANGED") {
      inHumanStage = humanStages.has((e.type === "CREATED" ? data.stage : data.to) ?? "");
      // Entrar a una etapa de atención humana pausa la IA (moveStageTx).
      if (inHumanStage) aiEnabled = false;
    }
    const isHuman = !aiEnabled || inHumanStage;
    if (wasHuman && !isHuman) open = null;
    if (!wasHuman && isHuman && !open) {
      // Una persona que lo pasa a humano a mano ya lo está atendiendo: solo debe responder si el
      // cliente esperaba respuesta.
      if (e.actor !== "USER") open = { kind: "first", startedAt: e.createdAt };
      else if (contactPending) open = { kind: "reply", startedAt: e.createdAt };
    }
  }
  if (open && lead.status === "OPEN") waits.push({ leadId: lead.id, ...open, answeredAt: null, reassignedAt: null, assigneeId: lead.assigneeId });
  return waits;
}

async function humanStageNames(): Promise<Set<string>> {
  const stages = await db.stage.findMany({ where: { requiresHuman: true }, select: { name: true } });
  return new Set(stages.map((s) => s.name));
}

const historySelect = {
  id: true,
  status: true,
  assigneeId: true,
  events: { where: { type: { in: SLA_EVENTS } }, orderBy: { createdAt: "asc" }, select: { type: true, actor: true, userId: true, data: true, createdAt: true } },
  messages: { select: { author: true, userId: true, createdAt: true } },
} as const;

/** Esperas de los leads que tuvieron mensajes o eventos entre `from` y `to`. */
async function waitsBetween(from: Date, to: Date, funnelId?: string): Promise<Wait[]> {
  const activity = { createdAt: { gte: from, lt: to } };
  const leads = await db.lead.findMany({
    where: {
      contact: { channel: { not: "SIMULATOR" } },
      createdAt: { lt: to },
      OR: [{ messages: { some: activity } }, { events: { some: { ...activity, type: { in: SLA_EVENTS } } } }],
      ...(funnelId ? { stage: { funnelId } } : {}),
    },
    select: historySelect,
  });
  const names = await humanStageNames();
  return leads.flatMap((l) => waitsOf(l, names)).filter((w) => w.startedAt >= from && w.startedAt < to);
}

export type PendingWait = Wait & { contactName: string; assigneeName: string | null; elapsedMs: number; goalMs: number };

/**
 * Para las esperas abiertas basta la historia reciente: los eventos completos (son pocos y dicen
 * quién atiende el lead) y los últimos mensajes.
 */
const RECENT_MESSAGES = 50;

async function pendingWaitsWhere(where: Prisma.LeadWhereInput, settings: SlaSettings, now: Date): Promise<PendingWait[]> {
  const leads = await db.lead.findMany({
    where: {
      AND: [
        where,
        { status: "OPEN", contact: { channel: { not: "SIMULATOR" } } },
        { OR: [{ aiEnabled: false }, { stage: { requiresHuman: true } }] },
      ],
    },
    select: {
      ...historySelect,
      messages: { ...historySelect.messages, orderBy: { createdAt: "desc" }, take: RECENT_MESSAGES },
      contact: { select: { name: true } },
      assignee: { select: { name: true } },
    },
  });
  const names = await humanStageNames();
  return leads
    .flatMap((l) =>
      waitsOf(l, names)
        .filter((w) => !w.answeredAt && !w.reassignedAt)
        .map((w) => ({
          ...w,
          contactName: l.contact.name,
          assigneeName: l.assignee?.name ?? null,
          elapsedMs: businessMs(settings, w.startedAt, now),
          goalMs: goalMs(settings, w.kind),
        })),
    )
    .sort((a, b) => b.elapsedMs / b.goalMs - a.elapsedMs / a.goalMs);
}

/** Leads abiertos que hoy esperan respuesta del equipo, los más atrasados primero. */
export async function pendingWaits(s?: SlaSettings, now = new Date(), funnelId?: string): Promise<PendingWait[]> {
  return pendingWaitsWhere(funnelId ? { stage: { funnelId } } : {}, s ?? (await getSlaSettings()), now);
}

/**
 * De estos leads, los que esperan respuesta del equipo aunque el último mensaje no sea del cliente
 * (ej. la IA lo derivó con "te comunico con un ejecutivo"), con desde cuándo esperan.
 */
export async function openWaitStarts(leadIds: string[], now = new Date()): Promise<Map<string, Date>> {
  if (!leadIds.length) return new Map();
  const waits = await pendingWaitsWhere({ id: { in: leadIds } }, await getSlaSettings(), now);
  return new Map(waits.map((w) => [w.leadId, w.startedAt]));
}

/** De estos leads, los que pasaron la meta de respuesta, con cuánto llevan esperando (para las listas). */
export async function lateLeads(leadIds: string[], now = new Date()): Promise<Map<string, number>> {
  if (!leadIds.length) return new Map();
  const waits = await pendingWaitsWhere({ id: { in: leadIds } }, await getSlaSettings(), now);
  return new Map(waits.filter((w) => w.elapsedMs > w.goalMs).map((w) => [w.leadId, w.elapsedMs]));
}

export type SlaStats = { count: number; met: number; medianMs: number | null; maxMs: number | null };
export type SlaRow = {
  key: string;
  label: string;
  first: SlaStats;
  reply: SlaStats;
  /** Leads que se le quitaron por no responder a tiempo. */
  reassigned: number;
  waiting: number;
  overdue: number;
};
export type SlaReport = { first: SlaStats; reply: SlaStats; byExecutive: SlaRow[]; waiting: PendingWait[] };

function stats(times: number[], goal: number): SlaStats {
  const sorted = [...times].sort((a, b) => a - b);
  return {
    count: sorted.length,
    met: sorted.filter((t) => t <= goal).length,
    medianMs: sorted.length ? sorted[Math.ceil(sorted.length / 2) - 1] : null,
    maxMs: sorted.length ? sorted[sorted.length - 1] : null,
  };
}

export type SlaFilter = { from: Date; to: Date; assigneeId?: string; funnelId?: string };

/**
 * Cumplimiento del período: esperas que empezaron entre `from` y `to` y ya se respondieron, por
 * ejecutivo, más los leads que esperan ahora (`waiting`, sin importar el período).
 */
export async function getSlaReport(filter: SlaFilter, s?: SlaSettings, now = new Date()): Promise<SlaReport> {
  const settings = s ?? (await getSlaSettings());
  const [past, pending, users] = await Promise.all([
    waitsBetween(filter.from, filter.to, filter.funnelId),
    pendingWaits(settings, now, filter.funnelId),
    db.user.findMany({ select: { id: true, name: true } }),
  ]);
  const mine = (w: Wait) => !filter.assigneeId || w.assigneeId === filter.assigneeId;
  // Respondidas o reasignadas sin respuesta (estas nunca quedan en meta).
  const answered = past.filter((w) => (w.answeredAt || w.reassignedAt) && mine(w));
  const waiting = pending.filter(mine);

  const ms = (w: Wait) => businessMs(settings, w.startedAt, (w.answeredAt ?? w.reassignedAt)!);
  // Una reasignación antes de la meta no cuenta (pudo ser por otro motivo); después, es una meta fallida.
  const counted = (w: Wait) => !w.reassignedAt || ms(w) > goalMs(settings, w.kind);
  const times = (list: Wait[], kind: WaitKind) => list.filter((w) => w.kind === kind && counted(w)).map(ms);
  const groups = new Map<string, { answered: Wait[]; waiting: PendingWait[] }>();
  const group = (key: string) => groups.get(key) ?? (groups.set(key, { answered: [], waiting: [] }).get(key)!);
  for (const w of answered) group(w.assigneeId ?? "none").answered.push(w);
  for (const w of waiting) group(w.assigneeId ?? "none").waiting.push(w);
  const names = new Map(users.map((u) => [u.id, u.name]));
  const byExecutive = [...groups.entries()]
    .map(([key, g]) => ({
      key,
      label: key === "none" ? "Sin asignar" : (names.get(key) ?? "Usuario eliminado"),
      first: stats(times(g.answered, "first"), goalMs(settings, "first")),
      reply: stats(times(g.answered, "reply"), goalMs(settings, "reply")),
      reassigned: g.answered.filter((w) => w.reassignedAt && counted(w)).length,
      waiting: g.waiting.length,
      overdue: g.waiting.filter((w) => w.elapsedMs > w.goalMs).length,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return {
    first: stats(times(answered, "first"), goalMs(settings, "first")),
    reply: stats(times(answered, "reply"), goalMs(settings, "reply")),
    byExecutive,
    waiting,
  };
}

/**
 * Avisa las esperas que pasaron la meta (corre cada 5 minutos): al llegar a la meta, al ejecutivo
 * del lead (o a los admins si no tiene); al doble, también a los admins. Cada aviso sale una vez
 * por espera: queda un evento SLA_LATE con el inicio de la espera y el nivel.
 */
const ALERT_MAX_AGE_MS = 4 * 24 * HOUR_MS;

export async function notifyLateWaits(now = new Date()): Promise<{ notified: number }> {
  const s = await getSlaSettings();
  if (!s.alerts) return { notified: 0 };
  // Las esperas muy antiguas (leads olvidados antes de activar esto) no se avisan.
  const since = now.getTime() - ALERT_MAX_AGE_MS;
  const late = (await pendingWaits(s, now)).filter((w) => w.elapsedMs > w.goalMs && w.startedAt.getTime() >= since);
  let notified = 0;
  for (const w of late) {
    const startedAt = w.startedAt.toISOString();
    const sent = await db.leadEvent.findMany({ where: { leadId: w.leadId, type: "SLA_LATE", createdAt: { gte: w.startedAt } }, select: { data: true } });
    const levels = new Set(sent.map((e) => e.data as { startedAt?: string; level?: number }).filter((d) => d.startedAt === startedAt).map((d) => d.level));
    const what = w.kind === "first" ? "la primera respuesta" : "respuesta";
    const goal = `meta: ${formatDuration(w.goalMs)}`;
    const toSend: { level: number; body: string; admins: boolean }[] = [];
    if (!levels.has(1)) toSend.push({ level: 1, body: `Lleva ${formatDuration(w.elapsedMs)} esperando ${what} (${goal})`, admins: false });
    if (s.escalate && w.elapsedMs >= 2 * w.goalMs && !levels.has(2)) {
      const who = w.assigneeName ? `de ${w.assigneeName}` : "y no tiene ejecutivo";
      toSend.push({ level: 2, body: `Atrasado: ${formatDuration(w.elapsedMs)} sin respuesta ${who} (${goal})`, admins: true });
    }
    for (const n of toSend) {
      await db.$transaction(async (tx) => {
        const admins = n.admins ? (await tx.user.findMany({ where: { role: "ADMIN", active: true, deletedAt: null }, select: { id: true } })).map((u) => u.id) : undefined;
        await notifySlaLateTx(tx, w.leadId, n.body, admins);
        await tx.leadEvent.create({
          data: { leadId: w.leadId, type: "SLA_LATE", actor: "SYSTEM", reason: n.body, data: { startedAt, level: n.level, kind: w.kind } },
        });
      });
      notified++;
    }
  }
  if (notified) await deliverPendingPush();
  return { notified };
}

/**
 * Reasignación automática (corre con los avisos): si el ejecutivo no da la primera respuesta en
 * `reassignMinutes` de horario laboral desde que recibió el lead, pasa al ejecutivo con menos carga
 * que no lo haya tenido en esta espera. Un lead sin ejecutivo se asigna apenas haya alguien.
 */
export async function reassignLateWaits(now = new Date()): Promise<{ reassigned: number }> {
  const s = await getSlaSettings();
  if (!s.reassign) return { reassigned: 0 };
  const since = now.getTime() - ALERT_MAX_AGE_MS;
  const waits = (await pendingWaits(s, now)).filter((w) => w.kind === "first" && w.startedAt.getTime() >= since);
  let reassigned = 0;
  for (const w of waits) {
    // Quienes tuvieron el lead desde la última respuesta del equipo no vuelven a recibirlo.
    const lastReply = await db.message.findFirst({ where: { leadId: w.leadId, author: "USER" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    const assignments = await db.leadEvent.findMany({
      where: { leadId: w.leadId, type: "ASSIGNED", ...(lastReply ? { createdAt: { gt: lastReply.createdAt } } : {}) },
      orderBy: { createdAt: "asc" },
      select: { data: true, createdAt: true },
    });
    const last = assignments.at(-1)?.createdAt;
    const holder = last && last > w.startedAt ? last : w.startedAt;
    if (w.assigneeId && businessMs(s, holder, now) < s.reassignMinutes * 60_000) continue;
    const tried = [...assignments.map((a) => (a.data as { assigneeId?: string }).assigneeId ?? ""), w.assigneeId ?? ""].filter(Boolean);
    const reason = w.assigneeId
      ? `Sin primera respuesta en ${formatDuration(s.reassignMinutes * 60_000)}${w.assigneeName ? ` de ${w.assigneeName}` : ""}`
      : "Esperaba ejecutivo";
    const chosen = await db.$transaction((tx) => reassignTx(tx, w.leadId, tried, reason));
    if (chosen) reassigned++;
  }
  if (reassigned) await deliverPendingPush();
  return { reassigned };
}
