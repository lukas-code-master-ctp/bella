import { db } from "../db";
import { getAiOperation } from "../domain/ai-operation";
import { aiChannels } from "../domain/channels";
import { getFollowUpSettings, withinSendingHours } from "../domain/follow-ups";
import { getSetting, setSetting } from "../settings";
import { getAiConfig, missingKeyMessage } from "./config";
import { runAgent, type TurnOutcome } from "./agent";
import type { ProviderClients } from "./providers";
import { answerLead, hasUnanswered, withLeadClaim } from "./respond";

/** Seguimientos por revisión: cada uno es una llamada a la IA, así que se acota el tiempo. */
const BATCH = 10;
/** Cada cuánto se revisan los seguimientos al usar la app (además del cron cada 15 minutos). */
export const FOLLOW_UP_CHECK_MS = 5 * 60 * 1000;

/** Ventana de Meta para escribirle texto libre al cliente desde su último mensaje. */
const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const OUT_OF_WINDOW = "Pasaron más de 24 horas desde el último mensaje del cliente: el canal no permite escribirle.";

export type FollowUpRun = { sent: number; skipped: number; failed: number; reason?: string };

/**
 * Envía los seguimientos que ya vencieron. Cada lead se "toma" vaciando su followUpAt con una
 * condición, así dos revisiones simultáneas (cron y app) nunca le escriben dos veces.
 */
export async function runDueFollowUps(
  { now = new Date(), clients = {} as ProviderClients, limit = BATCH } = {},
): Promise<FollowUpRun> {
  const result: FollowUpRun = { sent: 0, skipped: 0, failed: 0 };
  const s = await getFollowUpSettings();
  if (!s.enabled) return { ...result, reason: "Los seguimientos están desactivados." };
  if ((await getAiOperation()).paused) return { ...result, reason: "La IA está apagada en Configuración → Funcionamiento IA." };
  if (!withinSendingHours(s, now)) return { ...result, reason: "Fuera del horario de envío." };
  const missing = clients.anthropic || clients.openrouter ? null : await missingKeyMessage((await getAiConfig()).provider);
  if (missing) return { ...result, reason: missing };

  const due = await db.lead.findMany({
    // Solo en canales donde la IA puede escribir sola (WhatsApp se enciende en Configuración → Canales).
    where: { status: "OPEN", aiEnabled: true, followUpAt: { lte: now }, contact: { channel: { in: await aiChannels() } } },
    orderBy: { followUpAt: "asc" },
    take: limit,
  });
  for (const lead of due) {
    const outcome = await followUpLead(lead.id, lead.followUpAt!, clients);
    result[outcome === "sent" ? "sent" : outcome === "error" ? "failed" : "skipped"]++;
  }
  return result;
}

/** Envía ahora el seguimiento de un lead (botón del lead), aunque no haya vencido. */
export async function sendFollowUpNow(leadId: string, clients: ProviderClients = {}) {
  const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId } });
  return followUpLead(leadId, lead.followUpAt, clients);
}

async function followUpLead(
  leadId: string,
  expected: Date | null,
  clients: ProviderClients,
): Promise<TurnOutcome | "error"> {
  // Si la IA le está respondiendo al cliente, el seguimiento espera a la próxima revisión.
  const outcome = (await withLeadClaim(leadId, () => followUpClaimed(leadId, expected, clients))) ?? "skipped";
  // Lo que escribió el cliente mientras corría el seguimiento no lo tomó nadie: se responde ahora.
  if (await hasUnanswered(leadId)) await answerLead(leadId, clients);
  return outcome;
}

async function followUpClaimed(
  leadId: string,
  expected: Date | null,
  clients: ProviderClients,
): Promise<TurnOutcome | "error"> {
  const claimed = await db.lead.updateMany({
    where: { id: leadId, followUpAt: expected },
    data: { followUpAt: null },
  });
  if (claimed.count === 0) return "skipped";
  const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId }, include: { contact: { select: { channel: true } } } });
  const last = await db.message.findFirst({ where: { leadId }, orderBy: { createdAt: "desc" } });
  // Un seguimiento automático es para cuando la última palabra fue de la IA: si un ejecutivo
  // escribió después, la conversación es suya. Lo agendado por la IA se respeta igual.
  if (!last || last.author === "CONTACT" || (!lead.followUpReason && last.author !== "AI")) {
    await db.lead.update({ where: { id: leadId }, data: { followUpReason: null } });
    return "skipped";
  }
  // WhatsApp, Instagram y Messenger rechazan texto libre pasadas 24 h del último mensaje del cliente.
  if (lead.contact.channel !== "SIMULATOR") {
    const lastContact = await db.message.findFirst({
      where: { leadId, author: "CONTACT" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (!lastContact || Date.now() - lastContact.createdAt.getTime() > REPLY_WINDOW_MS) {
      await db.$transaction([
        db.lead.update({ where: { id: leadId }, data: { followUpReason: null } }),
        db.leadEvent.create({
          data: { leadId, type: "FOLLOW_UP_SKIPPED", actor: "SYSTEM", reason: OUT_OF_WINDOW },
        }),
      ]);
      return "skipped";
    }
  }
  try {
    return await runAgent(leadId, clients, { count: lead.followUpCount, reason: lead.followUpReason });
  } catch (err) {
    console.error(`[follow-ups] lead ${leadId}:`, err);
    return "error";
  }
}

/** Revisión al usar la app: como mucho una vez cada FOLLOW_UP_CHECK_MS. Nunca lanza. */
export async function runDueFollowUpsIfStale(now = new Date()) {
  try {
    const { enabled } = await getFollowUpSettings();
    if (!enabled) return;
    const state = await getSetting<{ lastCheckAt?: string }>("followUpRunner", {});
    if (state.lastCheckAt && now.getTime() - new Date(state.lastCheckAt).getTime() < FOLLOW_UP_CHECK_MS) return;
    await setSetting("followUpRunner", { lastCheckAt: now.toISOString() });
    await runDueFollowUps({ now });
  } catch (err) {
    console.error("[follow-ups] revisión automática falló", err);
  }
}
