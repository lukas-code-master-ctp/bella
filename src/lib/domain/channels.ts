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
import {
  describeAttachment,
  messagingEvents,
  messengerApi,
  platformOf,
  type MessengerApi,
  type MessengerWebhook,
  type MetaPlatform,
  type MsgReferral,
  type MsgEvent,
} from "../channels/messenger";
import type { AdsApi } from "../channels/ads";
import { attachAdSource, attachLinkSource, takeRefCode } from "./attribution";
import { createLead } from "./leads";
import { receiveContactAudio, type MediaDeps } from "./messages";
import { notifyContactMessage } from "./notifications";

/** Por canal, si la IA responde sola a sus leads. Apagado: el equipo responde a mano. */
export type ChannelSettings = {
  whatsappAi: boolean;
  instagramAi: boolean;
  facebookAi: boolean;
};

export const DEFAULT_CHANNELS: ChannelSettings = { whatsappAi: false, instagramAi: false, facebookAi: false };

const AI_KEY = { WHATSAPP: "whatsappAi", INSTAGRAM: "instagramAi", FACEBOOK: "facebookAi" } as const;

export async function getChannelSettings(): Promise<ChannelSettings> {
  return { ...DEFAULT_CHANNELS, ...(await getSetting<Partial<ChannelSettings>>("channels", {})) };
}

export async function saveChannelSettings(s: Partial<ChannelSettings>) {
  await setSetting("channels", { ...(await getChannelSettings()), ...s });
}

/** Canales donde la IA puede escribirle sola al cliente (respuestas y seguimientos). */
export async function aiChannels(): Promise<Channel[]> {
  const s = await getChannelSettings();
  return ["SIMULATOR", ...(Object.keys(AI_KEY) as (keyof typeof AI_KEY)[]).filter((c) => s[AI_KEY[c]])];
}

// --- Entrantes ---------------------------------------------------------------------------

export type InboundDeps = { api?: WhatsAppApi; messenger?: MessengerApi; media?: MediaDeps; ads?: AdsApi };

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

/**
 * Lead abierto del contacto en el canal; si no tiene (es nuevo o su último lead se cerró), uno
 * nuevo. `name` se pide solo al crear el contacto (en Instagram y Messenger es una llamada a Meta).
 */
async function openLeadFor(
  channel: Exclude<Channel, "SIMULATOR">,
  externalId: string,
  name: () => Promise<string>,
  aiEnabled: boolean,
  phone?: string,
) {
  const contact = await db.contact.findUnique({
    where: { channel_externalId: { channel, externalId } },
    include: { leads: { where: { status: "OPEN" }, orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (contact?.leads[0]) return contact.leads[0].id;
  const lead = contact
    ? await createLead({ contactId: contact.id }, { aiEnabled })
    : await createLead({ name: await name(), channel, phone, externalId }, { aiEnabled });
  return lead.id;
}

/** Nota de voz del cliente: se descarga, se guarda y se transcribe; si falla, queda el aviso. */
async function receiveAudio(
  leadId: string,
  externalId: string,
  download: () => Promise<{ bytes: Uint8Array; mimeType: string }>,
  deps: InboundDeps,
) {
  try {
    const file = await download();
    const ext = file.mimeType.includes("ogg") ? "ogg" : (file.mimeType.split("/")[1]?.split(";")[0] ?? "audio");
    await receiveContactAudio(leadId, { ...file, fileName: `audio.${ext}` }, deps.media, externalId);
  } catch (err) {
    console.error(`[canales] nota de voz ${externalId}:`, err);
    // Sin el audio, la IA y el equipo saben que llegó y le piden que lo escriba.
    await db.message
      .create({ data: { leadId, author: "CONTACT", body: "[Nota de voz que no se pudo descargar]", externalId } })
      .catch(() => null);
  }
  await notifyContactMessage(leadId, "🎤 Nota de voz");
}

/** Guarda un mensaje de texto del cliente una sola vez (Meta puede reintentar el webhook). */
async function receiveText(leadId: string, externalId: string, body: string) {
  try {
    await db.message.create({ data: { leadId, author: "CONTACT", body, externalId } });
  } catch {
    // Otro servidor ya guardó el mismo mensaje.
    return false;
  }
  await notifyContactMessage(leadId, body);
  return true;
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
  const leadId = await openLeadFor("WHATSAPP", m.from, async () => profileName?.trim() || `+${m.from}`, aiEnabled, `+${m.from}`);
  const r = m.referral;
  if (r) {
    await attachAdSource(
      leadId,
      { adId: r.source_id, adType: r.source_type, headline: r.headline, body: r.body, url: r.source_url, ctwaClid: r.ctwa_clid },
      deps.ads,
    );
  }
  if (m.type === "audio" && m.audio) {
    const mediaId = m.audio.id;
    await receiveAudio(leadId, m.id, () => (deps.api ?? cloudApi).downloadMedia(mediaId), deps);
    return leadId;
  }
  // El código de una landing (/wa) une sus UTM al lead y no se guarda en el mensaje.
  const text = m.type === "text" ? await takeRefCode(leadId, body) : body;
  return (await receiveText(leadId, m.id, text)) ? leadId : null;
}

/**
 * Procesa un webhook de Instagram Direct o de Messenger: guarda los mensajes nuevos y marca como
 * leídos los enviados. Devuelve los leads a los que la IA debe responder.
 */
export async function receiveMessenger(payload: MessengerWebhook, deps: InboundDeps = {}): Promise<string[]> {
  const platform = platformOf(payload);
  if (!platform) return [];
  const aiOn = (await getChannelSettings())[AI_KEY[platform]];
  const toAnswer = new Set<string>();
  for (const event of messagingEvents(payload)) {
    if (event.read) {
      await applyRead(platform, event);
      continue;
    }
    const leadId = await receiveMessengerEvent(platform, event, aiOn, deps);
    if (!leadId) continue;
    const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId } });
    if (aiOn && lead.aiEnabled && lead.status === "OPEN") toAnswer.add(leadId);
  }
  return [...toAnswer];
}

async function receiveMessengerEvent(
  platform: MetaPlatform,
  event: MsgEvent,
  aiEnabled: boolean,
  deps: InboundDeps,
): Promise<string | null> {
  const m = event.message;
  // Los ecos son nuestros propios envíos (o respuestas desde la app de Meta): no son del cliente.
  if (m?.is_echo || m?.is_deleted) return null;
  const referral = event.referral ?? m?.referral ?? event.postback?.referral;
  // Un clic en un anuncio sin mensaje (conversación que ya existía) solo marca el origen.
  if (referral && !m && !event.postback) {
    const contact = await db.contact.findUnique({
      where: { channel_externalId: { channel: platform, externalId: event.sender.id } },
      include: { leads: { where: { status: "OPEN" }, orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (contact?.leads[0]) await attachReferral(contact.leads[0].id, referral, deps);
    return null;
  }
  const externalId = m?.mid ?? event.postback?.mid;
  if (!externalId || (await db.message.findUnique({ where: { externalId } }))) return null;
  const audio = m?.attachments?.find((a) => a.type === "audio" && a.payload?.url);
  const body =
    m?.text ?? event.postback?.title ?? m?.attachments?.filter((a) => a.type !== "audio").map(describeAttachment).join(" ") ?? "";
  if (!body && !audio) return null;

  const api = deps.messenger ?? messengerApi;
  const userId = event.sender.id;
  const fallback = platform === "INSTAGRAM" ? "Usuario de Instagram" : "Usuario de Facebook";
  const leadId = await openLeadFor(platform, userId, async () => (await api.profileName(platform, userId)) ?? fallback, aiEnabled);
  if (referral) await attachReferral(leadId, referral, deps);
  if (audio) {
    await receiveAudio(leadId, externalId, () => api.download(audio.payload!.url!), deps);
    return leadId;
  }
  return (await receiveText(leadId, externalId, body)) ? leadId : null;
}

/** Origen de un mensaje de Instagram o Messenger: un anuncio o un enlace m.me/ig.me con código. */
async function attachReferral(leadId: string, r: MsgReferral, deps: InboundDeps) {
  if (r.ad_id || r.source === "ADS") {
    await attachAdSource(
      leadId,
      { adId: r.ad_id, adType: "ad", headline: r.ads_context_data?.ad_title },
      deps.ads,
    );
  } else if (r.ref) {
    await attachLinkSource(leadId, r.ref.trim().toUpperCase());
  }
}

/** El cliente leyó: todo lo enviado hasta ese momento queda como leído. */
async function applyRead(platform: MetaPlatform, event: MsgEvent) {
  const contact = await db.contact.findUnique({
    where: { channel_externalId: { channel: platform, externalId: event.sender.id } },
  });
  if (!contact) return;
  const until = event.read?.watermark ? new Date(event.read.watermark) : new Date(event.timestamp ?? Date.now());
  await db.message.updateMany({
    where: {
      lead: { contactId: contact.id },
      author: { in: ["AI", "USER"] },
      deliveryStatus: { in: ["SENT", "DELIVERED"] },
      createdAt: { lte: until },
    },
    data: { deliveryStatus: "READ" },
  });
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

export type OutboundApis = { whatsapp?: WhatsAppApi; messenger?: MessengerApi };

/**
 * Envía por el canal del lead los mensajes de la IA y del equipo que aún no salen. En el
 * simulador no hace nada. Cada mensaje se "toma" antes de enviarlo, así dos llamadas
 * simultáneas nunca lo mandan dos veces. Devuelve el motivo del último envío fallido.
 */
export async function deliverOutbound(leadId: string, apis: OutboundApis = {}): Promise<string | null> {
  const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId }, include: { contact: true } });
  const { channel, externalId: to } = lead.contact;
  if (channel === "SIMULATOR" || !to) return null;
  const wa = apis.whatsapp ?? cloudApi;
  const meta = apis.messenger ?? messengerApi;
  const sender =
    channel === "WHATSAPP"
      ? { text: (body: string) => wa.sendText(to, body), audio: (url: string) => wa.sendAudio(to, url), name: "WhatsApp" }
      : {
          text: (body: string) => meta.sendText(channel, to, body),
          audio: (url: string) => meta.sendAudio(channel, to, url),
          name: channel === "INSTAGRAM" ? "Instagram" : "Messenger",
        };

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
        if (channel === "WHATSAPP" && !canSendAudio(m.mediaType)) {
          throw new ChannelSendError("WhatsApp no acepta este formato de audio. Graba desde Chrome o Safari actualizados.");
        }
        externalId = await sender.audio(m.mediaUrl);
      }
      if (m.body) externalId = await sender.text(m.body);
      await db.message.update({ where: { id: m.id }, data: { deliveryStatus: "SENT", externalId, deliveryError: null } });
    } catch (err) {
      lastError = err instanceof ChannelSendError ? err.message : `No se pudo enviar por ${sender.name}.`;
      if (!(err instanceof ChannelSendError)) console.error(`[canales] envío del mensaje ${m.id}:`, err);
      await db.message.update({ where: { id: m.id }, data: { deliveryStatus: "FAILED", deliveryError: lastError } });
    }
  }
  return lastError;
}
