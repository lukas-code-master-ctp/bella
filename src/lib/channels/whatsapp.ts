import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * WhatsApp Cloud API (directa con Meta). Credenciales en variables de entorno:
 * - WHATSAPP_TOKEN: token permanente de un usuario del sistema con permiso whatsapp_business_messaging.
 * - WHATSAPP_PHONE_NUMBER_ID: id del número (no el número en sí) en WhatsApp Manager.
 * - META_APP_SECRET: clave secreta de la app de Meta; firma los webhooks.
 * - META_VERIFY_TOKEN: texto que inventamos y se pega en Meta al registrar el webhook.
 */
export const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v23.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

export const WHATSAPP_ENV = ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "META_APP_SECRET", "META_VERIFY_TOKEN"] as const;

export function missingWhatsAppEnv(): string[] {
  return WHATSAPP_ENV.filter((k) => !process.env[k]);
}

/** Error de Meta al enviar, con un motivo legible para el ejecutivo. */
export class ChannelSendError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
  }
}

/** Lo que Bella necesita de WhatsApp. Se reemplaza en pruebas. */
export type WhatsAppApi = {
  sendText(to: string, body: string): Promise<string>;
  sendAudio(to: string, url: string): Promise<string>;
  downloadMedia(mediaId: string): Promise<{ bytes: Uint8Array; mimeType: string }>;
};

/** Motivo legible de los errores de Meta más comunes al enviar. */
export function describeMetaError(code: number | undefined, fallback: string): string {
  switch (code) {
    case 131047:
      return "Pasaron más de 24 horas desde el último mensaje del cliente: WhatsApp solo permite escribirle con una plantilla aprobada.";
    case 131026:
      return "WhatsApp no pudo entregarlo (el número no tiene WhatsApp o no aceptó los términos).";
    case 131053:
      return "WhatsApp no aceptó el archivo (formato o tamaño no soportado).";
    case 131056:
      return "Demasiados mensajes seguidos a este cliente; espera un momento.";
    case 190:
      return "El token de WhatsApp venció o no es válido (WHATSAPP_TOKEN).";
    case 131031:
      return "La cuenta de WhatsApp Business está bloqueada o restringida por Meta.";
    default:
      return fallback;
  }
}

async function graph<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) throw new ChannelSendError("Falta WHATSAPP_TOKEN en las variables de entorno.");
  const res = await fetch(`${GRAPH}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; code?: number; error_data?: { details?: string } };
  } & T;
  if (!res.ok || json.error) {
    const code = json.error?.code;
    const raw = json.error?.error_data?.details || json.error?.message || `HTTP ${res.status}`;
    throw new ChannelSendError(describeMetaError(code, `WhatsApp rechazó el envío: ${raw}`), code);
  }
  return json;
}

async function send(to: string, payload: Record<string, unknown>): Promise<string> {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!phoneId) throw new ChannelSendError("Falta WHATSAPP_PHONE_NUMBER_ID en las variables de entorno.");
  const res = await graph<{ messages?: { id: string }[] }>(`${phoneId}/messages`, {
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, ...payload }),
  });
  const id = res.messages?.[0]?.id;
  if (!id) throw new ChannelSendError("WhatsApp no devolvió el id del mensaje.");
  return id;
}

export const cloudApi: WhatsAppApi = {
  sendText: (to, body) => send(to, { type: "text", text: { body, preview_url: false } }),
  sendAudio: (to, url) => send(to, { type: "audio", audio: { link: url } }),
  async downloadMedia(mediaId) {
    const meta = await graph<{ url: string; mime_type: string }>(mediaId);
    const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } });
    if (!res.ok) throw new Error(`No se pudo descargar el archivo de WhatsApp (HTTP ${res.status}).`);
    return { bytes: new Uint8Array(await res.arrayBuffer()), mimeType: meta.mime_type };
  },
};

/** Formatos de audio que WhatsApp acepta para enviar. */
const SENDABLE_AUDIO = ["audio/ogg", "audio/mp4", "audio/mpeg", "audio/aac", "audio/amr"];

export function canSendAudio(mimeType: string | null) {
  return SENDABLE_AUDIO.includes((mimeType ?? "").split(";")[0].trim().toLowerCase());
}

/** Meta firma cada webhook con la clave secreta de la app (cabecera X-Hub-Signature-256). */
export function validSignature(rawBody: string, header: string | null, secret: string | undefined): boolean {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const given = Buffer.from(header.slice("sha256=".length), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// --- Webhook ----------------------------------------------------------------------------

type WaMedia = { id: string; mime_type?: string; caption?: string; filename?: string };

export type WaMessage = {
  from: string;
  id: string;
  timestamp?: string;
  type: string;
  text?: { body: string };
  audio?: WaMedia;
  image?: WaMedia;
  video?: WaMedia;
  document?: WaMedia;
  sticker?: WaMedia;
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  button?: { text: string };
  interactive?: { button_reply?: { title: string }; list_reply?: { title: string } };
  reaction?: { emoji?: string };
  contacts?: { name?: { formatted_name?: string } }[];
};

export type WaStatus = {
  id: string;
  status: "sent" | "delivered" | "read" | "failed";
  errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[];
};

export type WaValue = {
  metadata?: { phone_number_id?: string };
  contacts?: { wa_id: string; profile?: { name?: string } }[];
  messages?: WaMessage[];
  statuses?: WaStatus[];
};

export type WaWebhook = {
  object?: string;
  entry?: { changes?: { field?: string; value?: WaValue }[] }[];
};

/** Cambios de mensajes del número configurado (ignora otros números de la misma cuenta). */
export function webhookValues(payload: WaWebhook, phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID): WaValue[] {
  if (payload.object !== "whatsapp_business_account") return [];
  return (payload.entry ?? [])
    .flatMap((e) => e.changes ?? [])
    .filter((c) => c.field === "messages" && c.value)
    .map((c) => c.value!)
    .filter((v) => !phoneNumberId || !v.metadata?.phone_number_id || v.metadata.phone_number_id === phoneNumberId);
}

/**
 * Texto con que se guarda un mensaje que no es texto ni audio. Bella todavía no muestra
 * imágenes ni documentos, así que el equipo y la IA ven una descripción.
 */
export function describeMessage(m: WaMessage): string | null {
  const withCaption = (label: string, media?: WaMedia) =>
    media?.caption ? `[${label}] ${media.caption}` : `[${label}]`;
  switch (m.type) {
    case "text":
      return m.text?.body ?? "";
    case "image":
      return withCaption("Imagen", m.image);
    case "video":
      return withCaption("Video", m.video);
    case "document":
      return m.document?.filename ? `[Documento: ${m.document.filename}]` : withCaption("Documento", m.document);
    case "sticker":
      return "[Sticker]";
    case "location": {
      const l = m.location;
      return l ? `[Ubicación] ${[l.name, l.address].filter(Boolean).join(", ") || `${l.latitude}, ${l.longitude}`}` : "[Ubicación]";
    }
    case "contacts":
      return `[Contacto compartido] ${m.contacts?.[0]?.name?.formatted_name ?? ""}`.trim();
    case "button":
      return m.button?.text ?? "";
    case "interactive":
      return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "";
    case "reaction":
      // Una reacción no es un mensaje nuevo que responder.
      return null;
    default:
      return "[Mensaje que Bella aún no puede mostrar]";
  }
}
