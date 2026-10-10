import type { Channel } from "@prisma/client";
import { localWeekdayHour } from "../dates";
import { db } from "../db";
import { getSetting, setSetting } from "../settings";

/**
 * Cómo funciona la IA en los canales reales (WhatsApp, Instagram, Messenger): apagado general,
 * horario de atención y contexto de tickets anteriores. El simulador no se ve afectado, para
 * poder probar a la asistente aunque esté apagada o fuera de horario.
 */
export type AiOperationSettings = {
  /** Apagado general: la IA no responde ni hace seguimientos en ningún canal real. */
  paused: boolean;
  /** Si la IA responde solo dentro del horario de atención. */
  hoursEnabled: boolean;
  /** Días de atención, 0 = domingo … 6 = sábado (hora de Chile). */
  days: number[];
  /** Desde `from`:00 hasta antes de `to`:00 (si `to` < `from`, el horario cruza la medianoche). */
  from: number;
  to: number;
  /** Fuera de horario: no responder, o mandar una vez `outOfHoursMessage`. */
  outOfHours: "silent" | "message";
  outOfHoursMessage: string;
  /** La IA recibe un resumen de los últimos tickets cerrados del contacto. */
  previousTickets: boolean;
};

export const DEFAULT_AI_OPERATION: AiOperationSettings = {
  paused: false,
  hoursEnabled: false,
  days: [1, 2, 3, 4, 5],
  from: 9,
  to: 19,
  outOfHours: "message",
  outOfHoursMessage:
    "¡Hola! Gracias por escribirnos. En este momento estamos fuera de nuestro horario de atención; " +
    "te responderemos apenas volvamos.",
  previousTickets: true,
};

/** Tickets cerrados que ve la IA como contexto. */
export const PREVIOUS_TICKETS = 5;
/** Sin respuesta en este plazo, el mensaje fuera de horario se vuelve a mandar. */
export const OUT_OF_HOURS_REPEAT_MS = 12 * 60 * 60 * 1000;

export const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

export async function getAiOperation(): Promise<AiOperationSettings> {
  return { ...DEFAULT_AI_OPERATION, ...(await getSetting<Partial<AiOperationSettings>>("aiOperation", {})) };
}

export async function saveAiOperation(s: Partial<AiOperationSettings>) {
  await setSetting("aiOperation", { ...(await getAiOperation()), ...s });
}

export function withinBusinessHours(s: AiOperationSettings, now: Date): boolean {
  if (!s.hoursEnabled) return true;
  const { weekday, hour } = localWeekdayHour(now);
  if (s.from === s.to % 24) return s.days.includes(weekday);
  if (s.from < s.to) return s.days.includes(weekday) && hour >= s.from && hour < s.to;
  // Horario nocturno (ej. 20 a 2): la madrugada pertenece al día en que empezó.
  return hour >= s.from ? s.days.includes(weekday) : hour < s.to && s.days.includes((weekday + 6) % 7);
}

/** Por qué la IA no debe escribir ahora en un canal, o null si puede. */
export function aiBlocked(s: AiOperationSettings, channel: Channel, now: Date): "paused" | "closed" | null {
  if (channel === "SIMULATOR") return null;
  if (s.paused) return "paused";
  return withinBusinessHours(s, now) ? null : "closed";
}

/** "Lunes a viernes, de 9:00 a 19:00", para mostrar el horario. */
export function describeHours(s: AiOperationSettings): string {
  const days = [...s.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  const mondayFirst = days.map((d) => (d + 6) % 7);
  const consecutive = mondayFirst.every((d, i) => i === 0 || d === mondayFirst[i - 1] + 1);
  const dayText = !days.length
    ? "Ningún día"
    : days.length === 7
      ? "Todos los días"
      : consecutive && days.length > 2
        ? `${WEEKDAYS[days[0]]} a ${WEEKDAYS[days[days.length - 1]].toLowerCase()}`
        : days.map((d, i) => (i ? WEEKDAYS[d].toLowerCase() : WEEKDAYS[d])).join(", ");
  const hours = s.from === s.to % 24 ? "todo el día" : `de ${s.from}:00 a ${s.to}:00`;
  return `${dayText}, ${hours}`;
}

/**
 * Fuera de horario: si así está configurado, manda el mensaje automático, a lo más una vez cada
 * OUT_OF_HOURS_REPEAT_MS por lead. Devuelve true si creó el mensaje (falta enviarlo por el canal).
 */
export async function replyOutOfHours(leadId: string, s: AiOperationSettings, now = new Date()): Promise<boolean> {
  const body = s.outOfHoursMessage.trim();
  if (s.outOfHours !== "message" || !body) return false;
  const recent = await db.leadEvent.findFirst({
    where: { leadId, type: "OUT_OF_HOURS_REPLY", createdAt: { gt: new Date(now.getTime() - OUT_OF_HOURS_REPEAT_MS) } },
  });
  if (recent) return false;
  await db.$transaction([
    db.message.create({ data: { leadId, author: "AI", body } }),
    db.leadEvent.create({ data: { leadId, type: "OUT_OF_HOURS_REPLY", actor: "SYSTEM", data: { body } } }),
  ]);
  return true;
}

const fmtDate = (d: Date) => d.toLocaleDateString("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "2-digit", year: "numeric" });

/** Últimos tickets cerrados del contacto, en líneas para el <crm_state>. */
export async function previousTicketLines(leadId: string, contactId: string): Promise<string[]> {
  const leads = await db.lead.findMany({
    where: { contactId, id: { not: leadId }, status: { not: "OPEN" } },
    include: { stage: true },
    orderBy: [{ closedAt: "desc" }, { createdAt: "desc" }],
    take: PREVIOUS_TICKETS,
  });
  if (!leads.length) return [];
  return [
    "Tickets anteriores del contacto (cerrados, del más reciente al más antiguo):",
    ...leads.map((l) => {
      const result =
        l.status === "WON"
          ? `ganado${l.amount ? ` por ${l.amount.toLocaleString("es-CL")}` : ""}`
          : `perdido${l.lostReason ? ` (${l.lostReason})` : ""}`;
      const dates = `${fmtDate(l.createdAt)} a ${l.closedAt ? fmtDate(l.closedAt) : "?"}`;
      return `- ${dates}: ${result}, última etapa "${l.stage.name}"${l.aiSummary ? `. ${l.aiSummary}` : ""}`;
    }),
  ];
}
