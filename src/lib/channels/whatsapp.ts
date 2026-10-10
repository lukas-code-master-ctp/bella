import type { FileKind } from "../media";
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
  /** `from` es el phone_number_id que envía; sin él, WHATSAPP_PHONE_NUMBER_ID. */
  sendText(to: string, body: string, from?: string): Promise<string>;
  sendAudio(to: string, url: string, from?: string): Promise<string>;
  /** Imagen, video o documento por URL pública; `caption` va como texto del archivo. */
  sendFile(to: string, file: { kind: FileKind; url: string; fileName?: string; caption?: string }, from?: string): Promise<string>;
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

async function graph<T>(path: string, init: RequestInit = {}, what = "el envío"): Promise<T> {
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
    throw new ChannelSendError(describeMetaError(code, `WhatsApp rechazó ${what}: ${raw}`), code);
  }
  return json;
}

async function send(to: string, payload: Record<string, unknown>, from?: string): Promise<string> {
  const phoneId = from || process.env.WHATSAPP_PHONE_NUMBER_ID;
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
  sendText: (to, body, from) => send(to, { type: "text", text: { body, preview_url: false } }, from),
  sendAudio: (to, url, from) => send(to, { type: "audio", audio: { link: url } }, from),
  sendFile: (to, { kind, url, fileName, caption }, from) =>
    send(to, {
      type: kind,
      [kind]: {
        link: url,
        ...(caption ? { caption } : {}),
        ...(kind === "document" && fileName ? { filename: fileName } : {}),
      },
    }, from),
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
  /** Viene en el primer mensaje cuando la persona escribió desde un anuncio o publicación (clic a WhatsApp). */
  referral?: WaReferral;
};

export type WaReferral = {
  source_url?: string;
  source_id?: string;
  source_type?: string;
  headline?: string;
  body?: string;
  ctwa_clid?: string;
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

/**
 * Cambios de mensajes de los números configurados (ignora otros números de la misma cuenta).
 * Sin números configurados no filtra.
 */
export function webhookValues(
  payload: WaWebhook,
  phoneNumberIds: string | string[] | undefined = process.env.WHATSAPP_PHONE_NUMBER_ID,
): WaValue[] {
  if (payload.object !== "whatsapp_business_account") return [];
  const allowed = (Array.isArray(phoneNumberIds) ? phoneNumberIds : [phoneNumberIds]).filter((id): id is string => Boolean(id));
  return (payload.entry ?? [])
    .flatMap((e) => e.changes ?? [])
    .filter((c) => c.field === "messages" && c.value)
    .map((c) => c.value!)
    .filter((v) => !allowed.length || !v.metadata?.phone_number_id || allowed.includes(v.metadata.phone_number_id));
}

/** Datos de un número de la cuenta según Meta, para validar uno nuevo antes de guardarlo. */
export async function lookupWhatsAppNumber(phoneNumberId: string): Promise<{ displayPhone: string; name: string | null }> {
  const n = await graph<{ display_phone_number?: string; verified_name?: string }>(
    `${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`,
    {},
    "la consulta del número",
  );
  if (!n.display_phone_number) throw new ChannelSendError("Meta no devolvió el número de ese id.");
  return { displayPhone: n.display_phone_number, name: n.verified_name ?? null };
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

/** phone_number_id de los cambios de mensajes, sin filtrar por el número configurado. */
export function webhookPhoneIds(payload: WaWebhook): string[] {
  if (payload.object !== "whatsapp_business_account") return [];
  const ids = (payload.entry ?? [])
    .flatMap((e) => e.changes ?? [])
    .filter((c) => c.field === "messages")
    .map((c) => c.value?.metadata?.phone_number_id)
    .filter((id): id is string => Boolean(id));
  return [...new Set(ids)];
}

// --- Diagnóstico de la conexión con Meta -----------------------------------------------

export type WhatsAppCheck = {
  /** Número que corresponde a WHATSAPP_PHONE_NUMBER_ID, o el error de Meta al pedirlo. */
  phone: { display?: string; name?: string; platform?: string; status?: string } | { error: string };
  /** Cuenta de WhatsApp Business del número (de WHATSAPP_BUSINESS_ACCOUNT_ID o del token). */
  wabaId: string | null;
  /** Si la app de Bella está suscrita a esa cuenta; sin suscripción Meta no manda los mensajes. */
  subscribed: boolean | null;
  error?: string;
};

type DebugToken = {
  data?: { app_id?: string; granular_scopes?: { scope: string; target_ids?: string[] }[] };
};

async function tokenInfo() {
  const token = process.env.WHATSAPP_TOKEN ?? "";
  const res = await graph<DebugToken>(`debug_token?input_token=${encodeURIComponent(token)}`, {}, "la consulta del token");
  const wabas = res.data?.granular_scopes?.find((s) => s.scope === "whatsapp_business_management")?.target_ids ?? [];
  return { appId: res.data?.app_id ?? null, wabas };
}

/** Pregunta a Meta por el número configurado y por la suscripción de la app a su cuenta. */
export async function checkWhatsApp(): Promise<WhatsAppCheck> {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const result: WhatsAppCheck = { phone: { error: "Falta WHATSAPP_PHONE_NUMBER_ID." }, wabaId: null, subscribed: null };
  if (phoneId) {
    try {
      const p = await graph<{ display_phone_number?: string; verified_name?: string; platform_type?: string; status?: string }>(
        `${phoneId}?fields=display_phone_number,verified_name,platform_type,status`,
        {},
        "la consulta del número",
      );
      result.phone = { display: p.display_phone_number, name: p.verified_name, platform: p.platform_type, status: p.status };
    } catch (err) {
      result.phone = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  try {
    const { appId, wabas } = await tokenInfo();
    result.wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || (wabas.length === 1 ? wabas[0] : null);
    if (!result.wabaId) {
      result.error = wabas.length
        ? "El token tiene acceso a varias cuentas de WhatsApp Business: agrega WHATSAPP_BUSINESS_ACCOUNT_ID en Vercel."
        : "El token no tiene acceso a ninguna cuenta de WhatsApp Business (permiso whatsapp_business_management).";
      return result;
    }
    const subs = await graph<{ data?: { whatsapp_business_api_data?: { id?: string } }[] }>(`${result.wabaId}/subscribed_apps`, {}, "la consulta de la cuenta");
    const ids = (subs.data ?? []).map((a) => a.whatsapp_business_api_data?.id);
    result.subscribed = appId ? ids.includes(appId) : ids.length > 0;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }
  return result;
}

/** Suscribe la app del token a la cuenta de WhatsApp Business, para que Meta mande los mensajes. */
export async function subscribeWhatsAppApp(wabaId: string): Promise<void> {
  await graph(`${wabaId}/subscribed_apps`, { method: "POST" }, "la suscripción");
}
