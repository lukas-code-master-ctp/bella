import { db } from "../db";
import { aiChannels } from "../domain/channels";
import { getFollowUpSettings, withinSendingHours } from "../domain/follow-ups";
import { getSetting, setSetting } from "../settings";
import { getAiConfig, missingKeyMessage } from "./config";
import { runAgent, type TurnOutcome } from "./agent";
import type { ProviderClients } from "./providers";

/** Seguimientos por revisión: cada uno es una llamada a la IA, así que se acota el tiempo. */
const BATCH = 10;
/** Cada cuánto se revisan los seguimientos al usar la app (además del cron cada 15 minutos). */
export const FOLLOW_UP_CHECK_MS = 5 * 60 * 1000;

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
  if (!withinSendingHours(s, now)) return { ...result, reason: "Fuera del horario de envío." };
  const missing = clients.anthropic || clients.openrouter ? null : missingKeyMessage((await getAiConfig()).provider);
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
  const claimed = await db.lead.updateMany({
    where: { id: leadId, followUpAt: expected },
    data: { followUpAt: null },
  });
  if (claimed.count === 0) return "skipped";
  const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId } });
  const last = await db.message.findFirst({ where: { leadId }, orderBy: { createdAt: "desc" } });
  // Un seguimiento automático es para cuando la última palabra fue de la IA: si un ejecutivo
  // escribió después, la conversación es suya. Lo agendado por la IA se respeta igual.
  if (!last || last.author === "CONTACT" || (!lead.followUpReason && last.author !== "AI")) {
    await db.lead.update({ where: { id: leadId }, data: { followUpReason: null } });
    return "skipped";
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
