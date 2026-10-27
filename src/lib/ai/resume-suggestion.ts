import { db } from "../db";
import { TEAM_AUTHOR, teamAuthor } from "./team-author";
import { DAY_MS, toLocalInput } from "../dates";
import { completeOnce, jsonIn } from "./complete";
import type { ProviderClients } from "./providers";

/*
 * "No requiere respuesta": al abrir el diálogo, la IA lee el final de la conversación y sugiere cuándo
 * retomar el contacto (ej. el cliente dijo que quiere visitar en diciembre) y una nota para la tarea.
 * Es una llamada suelta y corta, solo cuando el ejecutivo lo pide; no toca el historial de la asistente.
 */

const MAX_MESSAGES = 20;
const MAX_CHARS_PER_MESSAGE = 600;
const NOTE_MAX = 300;
/** No sugiere fechas a más de este plazo. */
const MAX_DAYS_AHEAD = 540;

export type ResumeSuggestion = { date: string | null; note: string };

const SYSTEM = [
  "Ayudas a un ejecutivo de ventas que cierra por ahora una conversación con un cliente. Lees el final del chat " +
    "y sugieres cuándo retomar el contacto y una nota breve para la tarea de seguimiento.",
  "",
  "Reglas:",
  '- "fecha": AAAA-MM-DD, solo si el cliente dio una fecha o un plazo (ej. "en diciembre", "después de las ' +
    'vacaciones", "en dos semanas"). Si dio un mes, usa unos días antes del inicio de ese mes para alcanzar a ' +
    "coordinar. Debe ser posterior a <hoy>. Si no dio ningún plazo, null.",
  '- "nota": una o dos frases con lo que hay que retomar y lo que el cliente dejó pendiente (ej. "Quiere visitar ' +
    'en diciembre; confirmar presupuesto"). Sin datos de contacto ni saludos.',
  'Responde solo con JSON: {"fecha": "AAAA-MM-DD" | null, "nota": "..."}',
].join("\n");

/** Sugerencia de fecha (AAAA-MM-DD, en Chile) y nota para retomar el lead. */
export async function suggestResume(
  leadId: string,
  { now = new Date(), clients = {} }: { now?: Date; clients?: ProviderClients } = {},
): Promise<ResumeSuggestion> {
  const lead = await db.lead.findUniqueOrThrow({
    where: { id: leadId },
    include: {
      contact: { select: { name: true } },
      messages: { include: TEAM_AUTHOR, orderBy: { createdAt: "desc" }, take: MAX_MESSAGES },
    },
  });
  const conversation = [...lead.messages]
    .reverse()
    .map((m) => {
      const who = m.author === "CONTACT" ? "Cliente" : m.author === "AI" ? "Asistente IA" : teamAuthor(m);
      return `${who} (${toLocalInput(m.createdAt).slice(0, 10)}): ${(m.transcript ?? m.body).slice(0, MAX_CHARS_PER_MESSAGE)}`;
    })
    .join("\n");
  if (!conversation) return { date: null, note: "" };

  const today = toLocalInput(now).slice(0, 10);
  const input = [`<hoy>${today}</hoy>`, `Cliente: ${lead.contact.name}`, "", "<conversacion>", conversation, "</conversacion>"].join("\n");
  const { text } = await completeOnce({ system: SYSTEM, input, maxTokens: 800, effort: "low", clients });
  const parsed = (jsonIn(text) ?? {}) as { fecha?: unknown; nota?: unknown };

  const latest = toLocalInput(new Date(now.getTime() + MAX_DAYS_AHEAD * DAY_MS)).slice(0, 10);
  const date =
    typeof parsed.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.fecha) && parsed.fecha > today && parsed.fecha <= latest
      ? parsed.fecha
      : null;
  const note = typeof parsed.nota === "string" ? parsed.nota.trim().slice(0, NOTE_MAX) : "";
  return { date, note };
}
