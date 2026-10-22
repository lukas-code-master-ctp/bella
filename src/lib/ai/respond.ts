import { db } from "../db";
import { currentCompanyId } from "../tenant";
import { aiBlocked, getAiOperation } from "../domain/ai-operation";
import { companyActive } from "../domain/companies";
import { aiChannels, getChannelSettings, MAX_REPLY_DELAY_SECONDS } from "../domain/channels";
import { runAgent } from "./agent";
import { refreshLeadInsights } from "./insights";
import type { ProviderClients } from "./providers";

/** Lo que dura como máximo un turno de la IA antes de que otro servidor pueda tomar el lead. */
const BUSY_MS = 3 * 60 * 1000;

export async function hasUnanswered(leadId: string) {
  const [last, transcript] = await Promise.all([
    db.message.findFirst({ where: { leadId, author: "CONTACT" }, orderBy: { createdAt: "desc" } }),
    db.agentTranscript.findUnique({ where: { leadId } }),
  ]);
  return Boolean(last && (!transcript || last.createdAt > transcript.syncedUntil));
}

/**
 * Toma el lead para un turno de la IA y corre `fn`; devuelve null sin correrla si otro servidor
 * ya lo tiene. Todo turno (respuesta, seguimiento, botones del lead) pasa por aquí: dos turnos a
 * la vez mandarían dos mensajes y el último en guardar pisaría el historial del otro.
 */
export async function withLeadClaim<T>(leadId: string, fn: () => Promise<T>): Promise<T | null> {
  const now = new Date();
  const until = new Date(now.getTime() + BUSY_MS);
  const claimed = await db.lead.updateMany({
    where: { id: leadId, OR: [{ agentBusyUntil: null }, { agentBusyUntil: { lt: now } }] },
    data: { agentBusyUntil: until },
  });
  if (!claimed.count) return null;
  try {
    return await fn();
  } finally {
    // Solo se suelta si sigue siendo la toma propia (pudo vencer y tomarla otro).
    await db.lead.updateMany({ where: { id: leadId, agentBusyUntil: until }, data: { agentBusyUntil: null } });
  }
}

/**
 * La IA responde a un lead de un canal real. Cada webhook corre en su propio servidor, así que
 * el lead se "toma" en la base para que dos mensajes seguidos del cliente no reciban dos
 * respuestas a la vez: quien lo tiene responde todo lo pendiente antes de soltarlo, y quien no
 * lo pudo tomar no hace nada (lo suyo lo responde el otro).
 */
export async function answerLead(leadId: string, clients: ProviderClients = {}) {
  // Con la IA apagada en toda la plataforma no hay respuesta (ni resumen) en los canales reales.
  if ((await getAiOperation()).paused) return;
  // Empresa suspendida: la IA no le responde a nadie.
  if (!(await companyActive())) return;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ran = await withLeadClaim(leadId, async () => {
      try {
        // runAgent responde todo lo pendiente; si llegó algo más mientras pensaba, otra vuelta.
        for (let turn = 0; turn < 3; turn++) {
          if ((await runAgent(leadId, clients)) === "skipped") break;
        }
      } catch (err) {
        console.error(`[respond] lead ${leadId}:`, err);
      }
      return true;
    });
    if (!ran) return;
    // Un mensaje que llegó justo al soltar el lead quedaría sin respuesta: se revisa una vez más.
    if (!(await hasUnanswered(leadId))) break;
  }
  await refreshLeadInsights(leadId, { clients }).catch((err) => console.error(`[respond] resumen del lead ${leadId}:`, err));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Responde cuando el cliente lleva `replyDelaySeconds` sin escribir. Cada mensaje entrante llama
 * a esta función: espera el plazo y, si mientras tanto llegó otro mensaje, no hace nada porque
 * la llamada de ese mensaje (que espera su propio plazo) responderá todo junto.
 */
export async function answerLeadWhenQuiet(
  leadId: string,
  { clients = {}, wait = sleep }: { clients?: ProviderClients; wait?: (ms: number) => Promise<unknown> } = {},
) {
  const seconds = Math.min(Math.max((await getChannelSettings()).replyDelaySeconds || 0, 0), MAX_REPLY_DELAY_SECONDS);
  const delayMs = seconds * 1000;
  if (delayMs > 0) {
    await wait(delayMs);
    const last = await db.message.findFirst({ where: { leadId, author: "CONTACT" }, orderBy: { createdAt: "desc" } });
    // Un segundo de margen por la diferencia de reloj entre servidores y base de datos.
    if (last && Date.now() - last.createdAt.getTime() < delayMs - 1000) return;
  }
  await answerLead(leadId, clients);
}

/** Cuánto hacia atrás se buscan mensajes sin responder al abrir el horario o encender la IA. */
const WAITING_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const WAITING_BATCH = 10;

/**
 * Responde a los clientes que escribieron mientras la IA estaba apagada o fuera de horario. La
 * llama el cron cada 15 minutos y el botón de encender la IA. Devuelve cuántos leads respondió.
 */
export async function answerWaitingLeads(
  { now = new Date(), clients = {} as ProviderClients, limit = WAITING_BATCH } = {},
): Promise<number> {
  const operation = await getAiOperation();
  if (aiBlocked(operation, "WHATSAPP", now)) return 0;
  const channels = (await aiChannels()).filter((c) => c !== "SIMULATOR");
  if (!channels.length) return 0;
  // Solo los que esperan respuesta, el que espera hace más tiempo primero. Una toma vencida (un
  // turno que Vercel cortó) no deja al lead fuera. En SQL el filtro de empresa va explícito.
  const companyId = await currentCompanyId();
  const since = new Date(now.getTime() - WAITING_WINDOW_MS);
  const candidates = await db.$queryRaw<{ id: string }[]>`
    SELECT l.id FROM "Lead" l
    JOIN "Contact" c ON c.id = l."contactId"
    LEFT JOIN "AgentTranscript" t ON t."leadId" = l.id
    CROSS JOIN LATERAL (
      SELECT min(m."createdAt") AS waiting FROM "Message" m
      WHERE m."leadId" = l.id AND m.author = 'CONTACT' AND m."createdAt" > ${since}
        AND (t."syncedUntil" IS NULL OR m."createdAt" > t."syncedUntil")
    ) w
    WHERE l."companyId" = ${companyId} AND l.status = 'OPEN' AND l."aiEnabled"
      AND (l."agentBusyUntil" IS NULL OR l."agentBusyUntil" < ${now})
      AND c."blockedAt" IS NULL AND c.channel::text = ANY(${channels})
      AND w.waiting IS NOT NULL
    ORDER BY w.waiting
    LIMIT ${limit}`;
  for (const { id } of candidates) await answerLead(id, clients);
  return candidates.length;
}
