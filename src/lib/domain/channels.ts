import type { Channel } from "@prisma/client";
import { db } from "../db";
import { getSetting, setSetting } from "../settings";
import {
  canSendAudio,
  ChannelSendError,
  cloudApi,
  describeMessage,
  describeMetaError,
  webhookValues,
  type WaMessage,
  type WaStatus,
  type WaWebhook,
  type WhatsAppApi,
} from "../channels/whatsapp";
import { createLead } from "./leads";
import { receiveContactAudio, type MediaDeps } from "./messages";
import { notifyContactMessage } from "./notifications";

export type ChannelSettings = {
  /** La IA responde sola a los leads de WhatsApp. Apagado: el equipo responde a mano. */
  whatsappAi: boolean;
};

export const DEFAULT_CHANNELS: ChannelSettings = { whatsappAi: false };

export async function getChannelSettings(): Promise<ChannelSettings> {
  return { ...DEFAULT_CHANNELS, ...(await getSetting<Partial<ChannelSettings>>("channels", {})) };
}

export async function saveChannelSettings(s: ChannelSettings) {
  await setSetting("channels", s);
}

/** Canales donde la IA puede escribirle sola al cliente (respuestas y seguimientos). */
export async function aiChannels(): Promise<Channel[]> {
  const s = await getChannelSettings();
  return ["SIMULATOR", ...(s.whatsappAi ? (["WHATSAPP"] as const) : [])];
}

// --- Entrantes ---------------------------------------------------------------------------

export type InboundDeps = { api?: WhatsAppApi; media?: MediaDeps };

/**
 * Procesa un webhook de WhatsApp: guarda los mensajes nuevos (cada uno una sola vez, aunque
 * Meta reintente) y actualiza el estado de entrega de los enviados. Devuelve los leads a los
 * que la IA debe responder.
 */
export async function receiveWhatsApp(payload: WaWebhook, deps: InboundDeps = {}): Promise<string[]> {
  const toAnswer = new Set<string>();
  const { whatsappAi } = await getChannelSettings();
  for (const value of webhookValues(payload)) {
    const names = new Map((value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
    for (const m of value.messages ?? []) {
      const leadId = await receiveWhatsAppMessage(m, names.get(m.from), whatsappAi, deps);
      if (!leadId) continue;
      const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId } });
      if (whatsappAi && lead.aiEnabled && lead.status === "OPEN") toAnswer.add(leadId);
    }
    for (const s of value.statuses ?? []) await applyWhatsAppStatus(s);
  }
  return [...toAnswer];
}

/** Lead abierto del contacto; si no tiene (es nuevo o su último lead se cerró), uno nuevo. */
async function openLeadFor(waId: string, profileName: string | undefined, aiEnabled: boolean) {
  const contact = await db.contact.findUnique({
    where: { channel_externalId: { channel: "WHATSAPP", externalId: waId } },
    include: { leads: { where: { status: "OPEN" }, orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (contact?.leads[0]) return contact.leads[0].id;
  const lead = contact
    ? await createLead({ contactId: contact.id }, { aiEnabled })
    : await createLead(
        { name: profileName?.trim() || `+${waId}`, channel: "WHATSAPP", phone: `+${waId}`, externalId: waId },
        { aiEnabled },
      );
  return lead.id;
}

async function receiveWhatsAppMessage(
  m: WaMessage,
  profileName: string | undefined,
  aiEnabled: boolean,
  deps: InboundDeps,
): Promise<string | null> {
  if (await db.message.findUnique({ where: { externalId: m.id } })) return null;
  const body = m.type === "audio" ? "" : describeMessage(m);
  if (body === null) return null;
  const leadId = await openLeadFor(m.from, profileName, aiEnabled);

  if (m.type === "audio" && m.audio) {
    try {
      const file = await (deps.api ?? cloudApi).downloadMedia(m.audio.id);
      const ext = file.mimeType.includes("ogg") ? "ogg" : (file.mimeType.split("/")[1]?.split(";")[0] ?? "audio");
      await receiveContactAudio(leadId, { ...file, fileName: `whatsapp.${ext}` }, deps.media, m.id);
    } catch (err) {
      console.error(`[whatsapp] nota de voz ${m.id}:`, err);
      // Sin el audio, la IA y el equipo saben que llegó y le piden que lo escriba.
      await db.message
        .create({ data: { leadId, author: "CONTACT", body: "[Nota de voz que no se pudo descargar]", externalId: m.id } })
        .catch(() => null);
    }
    await notifyContactMessage(leadId, "🎤 Nota de voz");
    return leadId;
  }

  try {
    await db.message.create({ data: { leadId, author: "CONTACT", body, externalId: m.id } });
  } catch {
    // Meta reintentó el mismo mensaje y otro servidor ya lo guardó.
    return null;
  }
  await notifyContactMessage(leadId, body);
  return leadId;
}

const STATUS_RANK: Record<string, number> = { SENDING: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 1 };

/** Meta avisa cuando un mensaje enviado se entregó, se leyó o falló. Nunca retrocede de estado. */
async function applyWhatsAppStatus(s: WaStatus) {
  const message = await db.message.findUnique({ where: { externalId: s.id } });
  if (!message) return;
  const next = s.status.toUpperCase();
  if (next !== "FAILED" && (STATUS_RANK[message.deliveryStatus ?? ""] ?? -1) >= STATUS_RANK[next]) return;
  if (next === "FAILED" && ["DELIVERED", "READ"].includes(message.deliveryStatus ?? "")) return;
  const e = s.errors?.[0];
  await db.message.update({
    where: { id: message.id },
    data: {
      deliveryStatus: next,
      deliveryError: next === "FAILED" ? describeMetaError(e?.code, e?.error_data?.details || e?.message || e?.title || "WhatsApp no pudo entregar el mensaje.") : null,
    },
  });
}

// --- Salientes ---------------------------------------------------------------------------

/**
 * Envía por el canal del lead los mensajes de la IA y del equipo que aún no salen. En el
 * simulador no hace nada. Cada mensaje se "toma" antes de enviarlo, así dos llamadas
 * simultáneas nunca lo mandan dos veces. Devuelve el motivo del último envío fallido.
 */
export async function deliverOutbound(leadId: string, api: WhatsAppApi = cloudApi): Promise<string | null> {
  const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId }, include: { contact: true } });
  if (lead.contact.channel !== "WHATSAPP" || !lead.contact.externalId) return null;
  const to = lead.contact.externalId;
  const pending = await db.message.findMany({
    where: { leadId, author: { in: ["AI", "USER"] }, deliveryStatus: null },
    orderBy: { createdAt: "asc" },
  });
  let lastError: string | null = null;
  for (const m of pending) {
    const claimed = await db.message.updateMany({ where: { id: m.id, deliveryStatus: null }, data: { deliveryStatus: "SENDING" } });
    if (!claimed.count) continue;
    try {
      let externalId: string | null = null;
      if (m.mediaUrl) {
        if (!canSendAudio(m.mediaType)) {
          throw new ChannelSendError("WhatsApp no acepta este formato de audio. Graba desde Chrome o Safari actualizados.");
        }
        externalId = await api.sendAudio(to, m.mediaUrl);
      }
      if (m.body) externalId = await api.sendText(to, m.body);
      await db.message.update({ where: { id: m.id }, data: { deliveryStatus: "SENT", externalId, deliveryError: null } });
    } catch (err) {
      lastError = err instanceof ChannelSendError ? err.message : "No se pudo enviar por WhatsApp.";
      if (!(err instanceof ChannelSendError)) console.error(`[whatsapp] envío del mensaje ${m.id}:`, err);
      await db.message.update({ where: { id: m.id }, data: { deliveryStatus: "FAILED", deliveryError: lastError } });
    }
  }
  return lastError;
}
