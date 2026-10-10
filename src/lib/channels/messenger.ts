import type { FileKind } from "../media";
import { GRAPH_VERSION, ChannelSendError } from "./whatsapp";

/**
 * Instagram Direct y Facebook Messenger (Messenger Platform de Meta). Ambos usan el token de la
 * página de Facebook, a la que debe estar vinculada la cuenta profesional de Instagram:
 * - META_PAGE_ACCESS_TOKEN: token de página permanente (pages_messaging, instagram_manage_messages…).
 * - META_PAGE_ID: id de la página de Facebook.
 * - META_IG_ACCOUNT_ID: id de la cuenta de Instagram profesional (opcional; filtra el webhook).
 * Los webhooks se firman con META_APP_SECRET y se verifican con META_VERIFY_TOKEN, igual que WhatsApp.
 */
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

export const MESSENGER_ENV = ["META_PAGE_ACCESS_TOKEN", "META_PAGE_ID", "META_APP_SECRET", "META_VERIFY_TOKEN"] as const;

export function missingMessengerEnv(): string[] {
  return MESSENGER_ENV.filter((k) => !process.env[k]);
}

export type MetaPlatform = "INSTAGRAM" | "FACEBOOK";

/** Lo que Bella necesita de Instagram y Messenger. Se reemplaza en pruebas. */
export type MessengerApi = {
  sendText(platform: MetaPlatform, to: string, body: string): Promise<string>;
  sendAudio(platform: MetaPlatform, to: string, url: string): Promise<string>;
  /** Imagen, video o documento por URL pública (Meta no admite texto junto al archivo). */
  sendFile(platform: MetaPlatform, to: string, file: { kind: FileKind; url: string }): Promise<string>;
  /** Nombre visible de quien escribe (null si Meta no lo entrega). */
  profileName(platform: MetaPlatform, userId: string): Promise<string | null>;
  download(url: string): Promise<{ bytes: Uint8Array; mimeType: string }>;
};

/** Motivo legible de los errores de Meta más comunes al enviar por Messenger o Instagram. */
export function describeMessengerError(code: number | undefined, subcode: number | undefined, fallback: string) {
  if (code === 10 && subcode === 2018278) {
    return "Pasaron más de 24 horas desde el último mensaje del cliente: Meta ya no permite escribirle por este canal.";
  }
  if (code === 551 || subcode === 2018108) return "Esta persona no está disponible para recibir mensajes.";
  if (code === 190) return "El token de la página venció o no es válido (META_PAGE_ACCESS_TOKEN).";
  if (code === 200 || code === 10) return "La app de Meta no tiene permiso para enviar este mensaje (revisa la revisión de la app).";
  return fallback;
}

/** Llamada a la Graph API con el token de la página. */
export async function pageGraph<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!token) throw new ChannelSendError("Falta META_PAGE_ACCESS_TOKEN en las variables de entorno.");
  const res = await fetch(`${GRAPH}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; code?: number; error_subcode?: number };
  } & T;
  if (!res.ok || json.error) {
    const e = json.error;
    throw new ChannelSendError(
      describeMessengerError(e?.code, e?.error_subcode, `Meta rechazó el envío: ${e?.message ?? `HTTP ${res.status}`}`),
      e?.code,
    );
  }
  return json;
}

async function send(to: string, message: Record<string, unknown>): Promise<string> {
  const pageId = process.env.META_PAGE_ID;
  if (!pageId) throw new ChannelSendError("Falta META_PAGE_ID en las variables de entorno.");
  const res = await pageGraph<{ message_id?: string }>(`${pageId}/messages`, {
    method: "POST",
    body: JSON.stringify({ recipient: { id: to }, messaging_type: "RESPONSE", message }),
  });
  if (!res.message_id) throw new ChannelSendError("Meta no devolvió el id del mensaje.");
  return res.message_id;
}

export const messengerApi: MessengerApi = {
  sendText: (_platform, to, body) => send(to, { text: body }),
  sendAudio: (_platform, to, url) => send(to, { attachment: { type: "audio", payload: { url, is_reusable: false } } }),
  sendFile: (_platform, to, { kind, url }) =>
    send(to, { attachment: { type: kind === "document" ? "file" : kind, payload: { url, is_reusable: true } } }),
  async profileName(platform, userId) {
    try {
      if (platform === "INSTAGRAM") {
        const p = await pageGraph<{ name?: string; username?: string }>(`${userId}?fields=name,username`);
        return p.name || (p.username ? `@${p.username}` : null);
      }
      const p = await pageGraph<{ first_name?: string; last_name?: string }>(`${userId}?fields=first_name,last_name`);
      return [p.first_name, p.last_name].filter(Boolean).join(" ") || null;
    } catch {
      return null;
    }
  },
  async download(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`No se pudo descargar el archivo de Meta (HTTP ${res.status}).`);
    return { bytes: new Uint8Array(await res.arrayBuffer()), mimeType: res.headers.get("content-type") ?? "audio/mp4" };
  },
};

// --- Webhook ----------------------------------------------------------------------------

export type MsgAttachment = { type: string; payload?: { url?: string; title?: string } };

export type MsgEvent = {
  sender: { id: string };
  recipient: { id: string };
  timestamp?: number;
  message?: {
    mid: string;
    text?: string;
    is_echo?: boolean;
    is_deleted?: boolean;
    attachments?: MsgAttachment[];
    quick_reply?: { payload?: string };
    referral?: MsgReferral;
  };
  postback?: { mid?: string; title?: string; payload?: string; referral?: MsgReferral };
  /** Clic en un anuncio o enlace m.me/ig.me con `ref` en una conversación que ya existía. */
  referral?: MsgReferral;
  read?: { watermark?: number; mid?: string };
};

/** Anuncio de clic a Messenger o Instagram Direct (source ADS) o enlace con `ref`. */
export type MsgReferral = {
  source?: string;
  type?: string;
  ref?: string;
  ad_id?: string;
  ads_context_data?: { ad_title?: string; post_id?: string; photo_url?: string; video_url?: string };
};

/** Comentario nuevo: field "comments" en Instagram y "feed" (item "comment") en la página. */
export type CommentChange = {
  field?: string;
  value?: {
    // Instagram
    id?: string;
    text?: string;
    media?: { id?: string };
    // Facebook
    item?: string;
    verb?: string;
    comment_id?: string;
    post_id?: string;
    message?: string;
    // Ambos
    parent_id?: string;
    from?: { id?: string; username?: string; name?: string };
  };
};

export type MessengerWebhook = {
  object?: string;
  entry?: { id: string; time?: number; messaging?: MsgEvent[]; changes?: CommentChange[] }[];
};

/** Plataforma del webhook según su `object` ("page" es Messenger), o null si no es de mensajería. */
export function platformOf(payload: MessengerWebhook): MetaPlatform | null {
  return payload.object === "instagram" ? "INSTAGRAM" : payload.object === "page" ? "FACEBOOK" : null;
}

/** Eventos de mensajería dirigidos a la página o cuenta de Instagram configurada. */
export function messagingEvents(payload: MessengerWebhook): MsgEvent[] {
  const platform = platformOf(payload);
  if (!platform) return [];
  const own = platform === "INSTAGRAM" ? process.env.META_IG_ACCOUNT_ID : process.env.META_PAGE_ID;
  return (payload.entry ?? []).filter((e) => !own || e.id === own).flatMap((e) => e.messaging ?? []);
}

/** Texto con que se guarda un adjunto que no es audio. */
export function describeAttachment(a: MsgAttachment): string {
  const label: Record<string, string> = {
    image: "Imagen",
    video: "Video",
    file: "Archivo",
    location: "Ubicación",
    share: "Publicación compartida",
    story_mention: "Te mencionó en una historia",
    ig_reel: "Reel compartido",
    reel: "Reel compartido",
    fallback: "Enlace",
  };
  return `[${label[a.type] ?? "Adjunto"}]${a.payload?.title ? ` ${a.payload.title}` : ""}`;
}
