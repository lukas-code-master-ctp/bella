/**
 * Envío de correos con Resend (https://resend.com), por su API HTTP. Es de la plataforma, no de cada
 * empresa: todos los correos salen con la clave RESEND_API_KEY y el remitente EMAIL_FROM del servidor
 * (por defecto no-reply@avisos.beliapp.cl, un dominio verificado en Resend).
 */

/** Dirección pública de la app, para los enlaces de los correos. Vacía si no se conoce. */
export const APP_URL =
  process.env.APP_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");

export const DEFAULT_EMAIL_FROM = "Beliapp <no-reply@avisos.beliapp.cl>";

export type Email = { from: string; to: string[]; subject: string; html: string; text: string };

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

export const resendSender: EmailSender = {
  async send(email) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new EmailError("Falta RESEND_API_KEY en el servidor.");
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
