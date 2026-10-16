import type { FileKind } from "../media";
import { createHmac, timingSafeEqual } from "node:crypto";
import { credential, missingCredentials } from "../credentials";

/**
 * WhatsApp Cloud API (directa con Meta). Credenciales (Configuración → Credenciales, ver credentials.ts):
 * - WHATSAPP_TOKEN: token permanente de un usuario del sistema con permiso whatsapp_business_messaging.
 * - WHATSAPP_PHONE_NUMBER_ID: id del número (no el número en sí) en WhatsApp Manager.
 * - META_APP_SECRET: clave secreta de la app de Meta; firma los webhooks.
 * - META_VERIFY_TOKEN: texto que inventamos y se pega en Meta al registrar el webhook.
 */
export const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v23.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

export const WHATSAPP_ENV = ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "META_APP_SECRET", "META_VERIFY_TOKEN"] as const;

export function missingWhatsAppEnv(): Promise<string[]> {
  return missingCredentials(WHATSAPP_ENV);
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

/** Lo que Beliapp necesita de WhatsApp. Se reemplaza en pruebas. */
export type WhatsAppApi = {
  /** `from` es el phone_number_id que envía; sin él, WHATSAPP_PHONE_NUMBER_ID. */
  sendText(to: string, body: string, from?: string): Promise<string>;
  sendAudio(to: string, url: string, from?: string): Promise<string>;
  /** Imagen, video o documento por URL pública; `caption` va como texto del archivo. */
  sendFile(to: string, file: { kind: FileKind; url: string; fileName?: string; caption?: string }, from?: string): Promise<string>;
  downloadMedia(mediaId: string): Promise<{ bytes: Uint8Array; mimeType: string }>;
  /** Plantilla aprobada en Meta; `params` llena las variables del cuerpo ({{1}}, {{2}}…). */
  sendTemplate?(to: string, template: { name: string; language: string; params: string[] }, from?: string): Promise<string>;
};

/** Motivo legible de los errores de Meta más comunes al enviar. */
export function describeMetaError(code: number | undefined, fallback: string): string {
  switch (code) {
    case 131047:
      return "Pasaron más de 24 horas desde el último mensaje del cliente: WhatsApp solo permite escribirle con una plantilla aprobada.";
    case 132001:
      return "La plantilla no existe en WhatsApp Manager o no está aprobada en ese idioma.";
    case 132000:
      return "La plantilla espera otra cantidad de variables: revisa su texto en Configuración → Seguimientos.";
    case 131026:
      return "WhatsApp no pudo entregarlo (el número no tiene WhatsApp o no aceptó los términos).";
    case 131053:
      return "WhatsApp no aceptó el archivo (formato o tamaño no soportado).";
    case 131056:
      return "Demasiados mensajes seguidos a este cliente; espera un momento.";
    case 190:
      return "El token de WhatsApp venció o no es válido (Configuración → Credenciales).";
    case 131031:
      return "La cuenta de WhatsApp Business está bloqueada o restringida por Meta.";
    default:
      return fallback;
  }
}

async function graph<T>(path: string, init: RequestInit = {}, what = "el envío"): Promise<T> {
  const token = await credential("WHATSAPP_TOKEN");
  if (!token) throw new ChannelSendError("Falta el token de WhatsApp en Configuración → Credenciales.");
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
  const phoneId = from || (await credential("WHATSAPP_PHONE_NUMBER_ID"));
  if (!phoneId) throw new ChannelSendError("Falta el id del número de WhatsApp en Configuración → Credenciales.");
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
  sendTemplate: (to, { name, language, params }, from) =>
    send(to, {
      type: "template",
      template: {
        name,
        language: { code: language },
        ...(params.length
          ? { components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }] }
          : {}),
      },
    }, from),
  async downloadMedia(mediaId) {
    const meta = await graph<{ url: string; mime_type: string }>(mediaId);
    const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${await credential("WHATSAPP_TOKEN")}` } });
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
export function webhookValues(payload: WaWebhook, phoneNumberIds: string | string[] | undefined): WaValue[] {
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
 * Texto con que se guarda un mensaje que no es texto ni audio. Beliapp todavía no muestra
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
      return "[Mensaje que Beliapp aún no puede mostrar]";
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
  /** Si la app de Beliapp está suscrita a esa cuenta; sin suscripción Meta no manda los mensajes. */
  subscribed: boolean | null;
  error?: string;
};

type DebugToken = {
  data?: { app_id?: string; granular_scopes?: { scope: string; target_ids?: string[] }[] };
};

async function tokenInfo() {
  const token = (await credential("WHATSAPP_TOKEN")) ?? "";
  const res = await graph<DebugToken>(`debug_token?input_token=${encodeURIComponent(token)}`, {}, "la consulta del token");
  const wabas = res.data?.granular_scopes?.find((s) => s.scope === "whatsapp_business_management")?.target_ids ?? [];
  return { appId: res.data?.app_id ?? null, wabas };
}

/** Pregunta a Meta por el número configurado y por la suscripción de la app a su cuenta. */
export async function checkWhatsApp(): Promise<WhatsAppCheck> {
  const phoneId = await credential("WHATSAPP_PHONE_NUMBER_ID");
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
    result.wabaId = (await credential("WHATSAPP_BUSINESS_ACCOUNT_ID")) || (wabas.length === 1 ? wabas[0] : null);
    if (!result.wabaId) {
      result.error = wabas.length
        ? "El token tiene acceso a varias cuentas de WhatsApp Business: agrega el id de la cuenta de WhatsApp Business en Configuración → Credenciales."
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

// --- Plantillas ----------------------------------------------------------------------------

/** Cuenta de WhatsApp Business: la de Credenciales o, si el token ve una sola, esa. */
async function wabaId(): Promise<string> {
  const saved = await credential("WHATSAPP_BUSINESS_ACCOUNT_ID");
  if (saved) return saved;
  const { wabas } = await tokenInfo();
  if (wabas.length === 1) return wabas[0];
  throw new ChannelSendError(
    "Falta el id de la cuenta de WhatsApp Business en Configuración → Credenciales (el token no permite deducirlo).",
  );
}

export type TemplateStatus = { status: string; reason?: string };

/**
 * Crea una plantilla de marketing con solo cuerpo y la manda a revisión de Meta. {{1}} necesita un
 * ejemplo para la revisión; va un nombre cualquiera.
 */
export async function submitTemplate(t: { name: string; language: string; text: string }): Promise<TemplateStatus> {
  const usesName = /\{\{\s*1\s*\}\}/.test(t.text);
  const res = await graph<{ status?: string }>(
    `${await wabaId()}/message_templates`,
    {
      method: "POST",
      body: JSON.stringify({
        name: t.name,
        language: t.language,
        category: "MARKETING",
        components: [{ type: "BODY", text: t.text, ...(usesName ? { example: { body_text: [["María"]] } } : {}) }],
      }),
    },
    "la plantilla",
  );
  return { status: res.status ?? "PENDING" };
}

/** Estado en Meta de la plantilla con ese nombre e idioma; null si no existe. */
export async function templateStatus(name: string, language: string): Promise<TemplateStatus | null> {
  const res = await graph<{ data?: { name: string; language: string; status: string; rejected_reason?: string }[] }>(
    `${await wabaId()}/message_templates?name=${encodeURIComponent(name)}&fields=name,language,status,rejected_reason`,
    {},
    "la consulta de la plantilla",
  );
  const t = (res.data ?? []).find((d) => d.name === name && d.language === language);
  if (!t) return null;
  return { status: t.status, reason: t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : undefined };
}
