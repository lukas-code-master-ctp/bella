import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { getSetting } from "../settings";

/**
 * Seguimiento de leads inactivos: cuando el cliente deja de responder, la IA le vuelve a
 * escribir según los plazos configurados (contados desde el último mensaje de la IA). La IA
 * también puede agendar un recontacto para una fecha (`schedule_follow_up`). El envío lo hace
 * src/lib/ai/follow-ups.ts.
 */
export type FollowUpSettings = {
  enabled: boolean;
  /** Minutos de silencio antes de cada seguimiento, en orden. Su largo es el máximo de intentos. */
  delays: number[];
  /** Horario de envío en hora de Chile: desde `sendFrom`:00 hasta antes de `sendTo`:00. */
  sendFrom: number;
  sendTo: number;
  /** Cómo escribir los seguimientos (se suman a las instrucciones de la asistente). */
  instructions: string;
};

export const DEFAULT_FOLLOW_UPS: FollowUpSettings = {
  enabled: false,
  delays: [3 * 60, 24 * 60, 3 * 24 * 60, 7 * 24 * 60],
  sendFrom: 9,
  sendTo: 21,
  instructions:
    "Retoma la conversación de forma breve y cercana, sin presionar. Aporta algo nuevo (una pregunta " +
    "concreta, un dato útil o una opción que le pueda servir) y no repitas tu mensaje anterior. En el " +
    "último seguimiento, pregúntale si prefiere que le escribamos más adelante.",
};

export const TIME_ZONE = "America/Santiago";
/** La IA responde exactamente esto cuando decide que no corresponde escribirle al cliente. */
export const NO_FOLLOW_UP = "SIN_SEGUIMIENTO";
/** Hasta cuándo puede agendar la IA un recontacto. */
const MAX_SCHEDULE_DAYS = 180;

type Tx = Prisma.TransactionClient;

export async function getFollowUpSettings(): Promise<FollowUpSettings> {
  return { ...DEFAULT_FOLLOW_UPS, ...(await getSetting<Partial<FollowUpSettings>>("followUps", {})) };
}

// Plazos ("3h, 1d, 30m")

const UNIT_MINUTES: Record<string, number> = { m: 1, min: 1, h: 60, d: 24 * 60 };

/** Lee una lista de plazos como "3h, 1d, 3d, 7d". Devuelve null si alguno no se entiende. */
export function parseDelays(text: string): number[] | null {
  const parts = text.split(/[,;\s]+/).filter(Boolean);
  const delays: number[] = [];
  for (const part of parts) {
    const match = part.toLowerCase().match(/^(\d+(?:\.\d+)?)(m|min|h|d)$/);
    if (!match) return null;
    const minutes = Math.round(Number(match[1]) * UNIT_MINUTES[match[2]]);
    if (minutes < 1) return null;
    delays.push(minutes);
  }
  return delays;
}

export function formatDelay(minutes: number): string {
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

/** Duración legible ("3 horas", "2 días"), para la IA y la pantalla. */
export function describeDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? "hora" : "horas"}`;
  const days = Math.round(hours / 24);
  return `${days} días`;
}

// Hora de Chile

function zonedParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

/** Convierte una fecha y hora de Chile ("2026-10-12 10:00") a un instante. Null si no es válida. */
export function parseChileDateTime(text: string): Date | null {
  const m = text.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const [year, month, day, hour, minute] = [m[1], m[2], m[3], m[4] ?? "10", m[5] ?? "00"].map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  // Se ajusta por la diferencia horaria de Chile en esa fecha (cambia con el horario de verano).
  let instant = wall;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(instant));
    instant += wall - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  }
  const date = new Date(instant);
  return zonedParts(date).day === day ? date : null;
}

/** Fecha en hora de Chile para la IA y la pantalla, ej. "lunes 12 de octubre de 2026, 10:00". */
export function formatChileDateTime(date: Date): string {
  return date.toLocaleString("es-CL", {
    timeZone: TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

export function withinSendingHours(s: FollowUpSettings, now: Date): boolean {
  const { hour } = zonedParts(now);
  return s.sendFrom < s.sendTo ? hour >= s.sendFrom && hour < s.sendTo : hour >= s.sendFrom || hour < s.sendTo;
}

// Programación

/** Plazo del seguimiento número `index` (0 = el primero), o null si ya no quedan. */
export function nextFollowUpAt(s: FollowUpSettings, from: Date, index: number): Date | null {
  if (!s.enabled || index >= s.delays.length) return null;
  return new Date(from.getTime() + s.delays[index] * 60_000);
}

/**
 * Después de cada turno de la IA deja programado el siguiente seguimiento. `agendaChanged` indica
 * que la IA usó schedule_follow_up en este turno (lo que dejó la herramienta se respeta).
 */
export async function scheduleAfterAiTurnTx(
  tx: Tx,
  leadId: string,
  turn: {
    sentAt: Date;
    /** El mensaje enviado; null si la IA decidió no escribir. */
    sent: boolean;
    agendaChanged: boolean;
    /** Turno de seguimiento: cuántos seguimientos automáticos ya se habían enviado antes. */
    followUp?: { count: number; scheduled: boolean };
  },
  s: FollowUpSettings,
) {
  const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
  if (!lead.aiEnabled || lead.status !== "OPEN" || !s.enabled) {
    await tx.lead.update({ where: { id: leadId }, data: { followUpAt: null, followUpReason: null } });
    return;
  }
  // Un recontacto automático suma uno a la cuenta; uno agendado por la IA no.
  const count = turn.followUp ? turn.followUp.count + (turn.followUp.scheduled ? 0 : 1) : 0;
  if (turn.agendaChanged) {
    await tx.lead.update({ where: { id: leadId }, data: { followUpCount: count } });
    return;
  }
  // Si la IA dejó agendado un recontacto (de un turno anterior) que aún no llega, se mantiene.
  if (!turn.followUp && lead.followUpReason && lead.followUpAt && lead.followUpAt > turn.sentAt) {
    await tx.lead.update({ where: { id: leadId }, data: { followUpCount: 0 } });
    return;
  }
  await tx.lead.update({
    where: { id: leadId },
    data: {
      followUpCount: count,
      followUpReason: null,
      // Si la IA decidió no escribir en un seguimiento, no se insiste más.
      followUpAt: turn.sent ? nextFollowUpAt(s, turn.sentAt, count) : null,
    },
  });
}

/** Herramienta schedule_follow_up: agenda (o, con fecha vacía, cancela) el recontacto. */
export async function scheduleFollowUpTx(
  tx: Tx,
  leadId: string,
  input: { date: string; reason: string },
  now = new Date(),
): Promise<{ content: string; isError?: boolean }> {
  const s = await getFollowUpSettings();
  if (!s.enabled) {
    return {
      isError: true,
      content: "Los seguimientos están desactivados en esta cuenta: no prometas volver a escribir en una fecha.",
    };
  }
  if (!input.date.trim()) {
    await tx.lead.update({ where: { id: leadId }, data: { followUpAt: null, followUpReason: null } });
    await tx.leadEvent.create({ data: { leadId, type: "FOLLOW_UP_CANCELED", actor: "AI", reason: input.reason || null } });
    return { content: "Listo: no habrá más seguimientos hasta que el cliente vuelva a escribir." };
  }
  const at = parseChileDateTime(input.date);
  if (!at) return { isError: true, content: 'Fecha inválida. Usa el formato "AAAA-MM-DD HH:MM" en hora de Chile.' };
  if (at <= now) return { isError: true, content: "La fecha ya pasó: elige una fecha futura." };
  if (at.getTime() - now.getTime() > MAX_SCHEDULE_DAYS * 24 * 3600_000) {
    return { isError: true, content: `Solo se puede agendar hasta ${MAX_SCHEDULE_DAYS} días hacia adelante.` };
  }
  const reason = input.reason.trim() || "Recontacto acordado con el cliente";
  await tx.lead.update({ where: { id: leadId }, data: { followUpAt: at, followUpReason: reason } });
  await tx.leadEvent.create({
    data: { leadId, type: "FOLLOW_UP_SCHEDULED", actor: "AI", reason, data: { at: at.toISOString() } },
  });
  const hours = withinSendingHours(s, at) ? "" : ` Queda fuera del horario de envío, así que saldrá a las ${s.sendFrom}:00.`;
  return { content: `Recontacto agendado para el ${formatChileDateTime(at)}.${hours}` };
}

/** Línea del <crm_state> con el recontacto que la IA dejó agendado, si hay uno. */
export function agendaLine(lead: { followUpAt: Date | null; followUpReason: string | null }): string | null {
  if (!lead.followUpAt || !lead.followUpReason) return null;
  return `Recontacto agendado: ${formatChileDateTime(lead.followUpAt)} (${lead.followUpReason})`;
}

/** Un ejecutivo cancela los seguimientos pendientes de un lead. */
export async function cancelFollowUp(leadId: string, userId: string) {
  await db.$transaction([
    db.lead.update({ where: { id: leadId }, data: { followUpAt: null, followUpReason: null } }),
    db.leadEvent.create({ data: { leadId, type: "FOLLOW_UP_CANCELED", actor: "USER", userId } }),
  ]);
}
