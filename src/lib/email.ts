/**
 * Envío de correos con Resend (https://resend.com), por su API HTTP. Los avisos son de la plataforma:
 * salen con la clave RESEND_API_KEY y el remitente EMAIL_FROM del servidor (por defecto
 * no-reply@avisos.beliapp.cl). Los envíos masivos de cada empresa salen con la clave de Resend de
 * esa empresa (ver src/lib/domain/email-domains.ts).
 */

/** Dirección pública de la app, para los enlaces de los correos. Vacía si no se conoce. */
export const APP_URL =
  process.env.APP_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");

export const DEFAULT_EMAIL_FROM = "Beliapp <no-reply@avisos.beliapp.cl>";

export type Email = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  /** Envíos masivos: dirección para las respuestas y cabeceras de baja (List-Unsubscribe). */
  reply_to?: string;
  headers?: Record<string, string>;
};

/** Lo que Beliapp necesita para mandar correos. Se reemplaza en pruebas. */
export type EmailSender = { send(email: Email): Promise<string> };

export class EmailError extends Error {}

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

/** Remitente de todos los correos. */
export function emailFrom(): string {
  return process.env.EMAIL_FROM?.trim() || DEFAULT_EMAIL_FROM;
}

/** De dónde sale la clave de Resend: la de la plataforma (avisos) o la de una empresa (newsletters). */
type ResendKey = () => Promise<string | undefined> | string | undefined;
const platformKey: ResendKey = () => process.env.RESEND_API_KEY;
const PLATFORM_MISSING = "Falta RESEND_API_KEY en el servidor.";

async function keyOf(getKey: ResendKey, missing: string) {
  const key = await getKey();
  if (!key) throw new EmailError(missing);
  return key;
}

export function resendSenderWith(getKey: ResendKey, missing: string): EmailSender {
  return {
    async send(email) {
      const key = await keyOf(getKey, missing);
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(email),
      });
      const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!res.ok || !json.id) {
        throw new EmailError(`Resend rechazó el correo: ${json.message ?? `HTTP ${res.status}`}`);
      }
      return json.id;
    },
  };
}

/** Correos de la plataforma (avisos, contraseñas, resumen semanal). */
export const resendSender: EmailSender = resendSenderWith(platformKey, PLATFORM_MISSING);

/** Envío de muchos correos en una sola llamada (envíos masivos). Se reemplaza en pruebas. */
export type EmailBatchSender = {
  /** Devuelve el id de cada correo, en el mismo orden. La misma clave no envía dos veces. */
  sendBatch(emails: Email[], idempotencyKey: string): Promise<string[]>;
};

/** Hasta 100 correos por llamada (límite de Resend). */
export const RESEND_BATCH_MAX = 100;

export function resendBatchSenderWith(getKey: ResendKey, missing: string): EmailBatchSender {
  return {
    async sendBatch(emails, idempotencyKey) {
      const key = await keyOf(getKey, missing);
      const res = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(emails),
      });
      const json = (await res.json().catch(() => ({}))) as { data?: { id: string }[]; message?: string };
      if (!res.ok || !json.data || json.data.length !== emails.length) {
        throw new EmailError(`Resend rechazó los correos: ${json.message ?? `HTTP ${res.status}`}`);
      }
      return json.data.map((d) => d.id);
    },
  };
}

/** Direcciones válidas de un texto separado por comas, espacios o saltos de línea, sin repetir. */
export function parseEmails(text: string): string[] {
  const all = text
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
  return [...new Set(all)];
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
