import type { MessageAuthor } from "@prisma/client";
import { db } from "../db";
import { getSetting, setSetting } from "../settings";
import { withinBusinessHours, type WeeklyHours } from "./ai-operation";

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
};

export const DEFAULT_SLA: SlaSettings = {
  firstMinutes: 15,
  replyMinutes: 30,
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
  /** El ejecutivo a cargo cuando se respondió (o ahora, si sigue esperando). */
  assigneeId: string | null;
};

export type LeadHistory = {
  id: string;
  status: string;
  assigneeId: string | null;
  events: { type: string; actor: string; data: unknown; createdAt: Date }[];
  messages: { author: MessageAuthor; userId: string | null; createdAt: Date }[];
};

/** Eventos que cambian quién atiende el lead o quién es su ejecutivo. */
export const SLA_EVENTS = ["CREATED", "STAGE_CHANGED", "AI_PAUSED", "AI_RESUMED", "ASSIGNED", "UNASSIGNED"];

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
          waits.push({ leadId: lead.id, ...open, answeredAt: m.createdAt, assigneeId: assigneeId ?? m.userId });
          open = null;
        }
      }
      continue;
    }
    const e = item.event;
    const data = (e.data ?? {}) as { stage?: string; to?: string; assigneeId?: string };
    const wasHuman = !aiEnabled || inHumanStage;
    if (e.type === "ASSIGNED") assigneeId = data.assigneeId ?? assigneeId;
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
  if (open && lead.status === "OPEN") waits.push({ leadId: lead.id, ...open, answeredAt: null, assigneeId: lead.assigneeId });
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
  events: { where: { type: { in: SLA_EVENTS } }, select: { type: true, actor: true, data: true, createdAt: true } },
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

/** Leads abiertos que hoy esperan respuesta del equipo, los más atrasados primero. */
export async function pendingWaits(s?: SlaSettings, now = new Date(), funnelId?: string): Promise<PendingWait[]> {
  const settings = s ?? (await getSlaSettings());
  const leads = await db.lead.findMany({
    where: {
      status: "OPEN",
      contact: { channel: { not: "SIMULATOR" } },
      OR: [{ aiEnabled: false }, { stage: { requiresHuman: true } }],
      ...(funnelId ? { stage: { funnelId } } : {}),
    },
    select: { ...historySelect, contact: { select: { name: true } }, assignee: { select: { name: true } } },
  });
  const names = await humanStageNames();
  return leads
    .flatMap((l) =>
      waitsOf(l, names)
        .filter((w) => !w.answeredAt)
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

export type SlaStats = { count: number; met: number; medianMs: number | null; maxMs: number | null };
export type SlaRow = { key: string; label: string; first: SlaStats; reply: SlaStats; waiting: number; overdue: number };
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
  const answered = past.filter((w) => w.answeredAt && mine(w));
  const waiting = pending.filter(mine);

  const times = (list: Wait[], kind: WaitKind) =>
    list.filter((w) => w.kind === kind).map((w) => businessMs(settings, w.startedAt, w.answeredAt!));
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
