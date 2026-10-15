import { db } from "../db";
import { getAiOperation } from "../domain/ai-operation";
import { aiChannels } from "../domain/channels";
import {
  getFollowUpSettings,
  nextFollowUpAt,
  renderTemplate,
  replyWindowEnd,
  whatsAppTemplateFor,
  withinSendingHours,
  type FollowUpSettings,
} from "../domain/follow-ups";
import { ChannelSendError, cloudApi, type WhatsAppApi } from "../channels/whatsapp";
import { getSetting, setSetting } from "../settings";
import { getAiConfig, missingKeyMessage } from "./config";
import { runAgent, type TurnOutcome } from "./agent";
import type { ProviderClients } from "./providers";
import { answerLead, hasUnanswered, withLeadClaim } from "./respond";

/** Seguimientos por revisión: cada uno es una llamada a la IA, así que se acota el tiempo. */
const BATCH = 10;
/** Cada cuánto se revisan los seguimientos al usar la app (además del cron cada 15 minutos). */
export const FOLLOW_UP_CHECK_MS = 5 * 60 * 1000;

export const OUT_OF_WINDOW = "Pasaron más de 24 horas desde el último mensaje del cliente: el canal no permite escribirle.";

/** Clientes de la IA y, en pruebas, de WhatsApp (para las plantillas). */
type Deps = ProviderClients & { whatsapp?: WhatsAppApi };

export type FollowUpRun = { sent: number; skipped: number; failed: number; reason?: string };

/**
 * Envía los seguimientos que ya vencieron. Cada lead se "toma" vaciando su followUpAt con una
 * condición, así dos revisiones simultáneas (cron y app) nunca le escriben dos veces.
 */
export async function runDueFollowUps(
  { now = new Date(), clients = {} as Deps, limit = BATCH } = {},
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
export async function sendFollowUpNow(leadId: string, clients: Deps = {}) {
  const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId } });
  return followUpLead(leadId, lead.followUpAt, clients);
}

async function followUpLead(
  leadId: string,
  expected: Date | null,
  clients: Deps,
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
  clients: Deps,
): Promise<TurnOutcome | "error"> {
  const claimed = await db.lead.updateMany({
    where: { id: leadId, followUpAt: expected },
    data: { followUpAt: null },
  });
  if (claimed.count === 0) return "skipped";
  const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId }, });
  const last = await db.message.findFirst({ where: { leadId }, orderBy: { createdAt: "desc" } });
  // Un seguimiento automático es para cuando la última palabra fue de la IA: si un ejecutivo
  // escribió después, la conversación es suya. Lo agendado por la IA se respeta igual.
  if (!last || last.author === "CONTACT" || (!lead.followUpReason && last.author !== "AI")) {
    await db.lead.update({ where: { id: leadId }, data: { followUpReason: null } });
    return "skipped";
  }
  // WhatsApp, Instagram y Messenger rechazan texto libre pasadas 24 h del último mensaje del cliente.
  const windowEnd = await replyWindowEnd(db, leadId);
  if (windowEnd && Date.now() > windowEnd.getTime()) {
    const s = await getFollowUpSettings();
    // En WhatsApp, pasadas las 24 h se puede escribir con una plantilla aprobada.
    if (await whatsAppTemplateFor(db, leadId, s)) return sendTemplateFollowUp(leadId, s, clients.whatsapp ?? cloudApi);
    await db.$transaction([
      db.lead.update({ where: { id: leadId }, data: { followUpReason: null } }),
      db.leadEvent.create({
        data: { leadId, type: "FOLLOW_UP_SKIPPED", actor: "SYSTEM", reason: OUT_OF_WINDOW },
      }),
    ]);
    return "skipped";
  }
  try {
    return await runAgent(leadId, clients, { count: lead.followUpCount, reason: lead.followUpReason });
  } catch (err) {
    console.error(`[follow-ups] lead ${leadId}:`, err);
    return "error";
  }
}

/**
 * Seguimiento con la plantilla de WhatsApp: no pasa por la IA (el texto es el aprobado en Meta).
 * Igual que el turno de la IA, deja programado el siguiente seguimiento.
 */
async function sendTemplateFollowUp(leadId: string, s: FollowUpSettings, api: WhatsAppApi): Promise<TurnOutcome | "error"> {
  const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId }, include: { contact: true } });
  const { externalId: to, blockedAt, waPhoneNumberId } = lead.contact;
  if (!to || blockedAt || !api.sendTemplate) return "skipped";
  const { body, params } = renderTemplate(s.template, lead.contact.name);
  const message = await db.message.create({ data: { leadId, author: "AI", body, deliveryStatus: "SENDING" } });
  try {
    const externalId = await api.sendTemplate(to, { name: s.template.name, language: s.template.language, params }, waPhoneNumberId ?? undefined);
    await db.message.update({ where: { id: message.id }, data: { deliveryStatus: "SENT", externalId } });
  } catch (err) {
    const reason = err instanceof ChannelSendError ? err.message : "No se pudo enviar la plantilla por WhatsApp.";
    if (!(err instanceof ChannelSendError)) console.error(`[follow-ups] plantilla, lead ${leadId}:`, err);
    await db.$transaction([
      db.message.update({ where: { id: message.id }, data: { deliveryStatus: "FAILED", deliveryError: reason } }),
      db.lead.update({ where: { id: leadId }, data: { followUpReason: null } }),
    ]);
    return "error";
  }
  // Un recontacto agendado por la IA no suma a la cuenta de seguimientos automáticos.
  const count = lead.followUpCount + (lead.followUpReason ? 0 : 1);
  await db.$transaction([
    db.lead.update({
      where: { id: leadId },
      data: { followUpCount: count, followUpReason: null, followUpAt: nextFollowUpAt(s, new Date(), count) },
    }),
    db.leadEvent.create({
      data: {
        leadId,
        type: "FOLLOW_UP_SENT",
        actor: "SYSTEM",
        reason: lead.followUpReason,
        data: { template: s.template.name, ...(lead.followUpReason ? {} : { number: count, total: s.delays.length }) },
      },
    }),
  ]);
  return "sent";
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
