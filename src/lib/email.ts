import { credential } from "./credentials";
import { getSetting } from "./settings";

/**
 * Envío de correos con Resend (https://resend.com), por su API HTTP. La clave (RESEND_API_KEY) y el
 * remitente (EMAIL_FROM, de un dominio verificado en Resend) son de cada empresa y se cargan en
 * Configuración → Credenciales.
 */

/** Dirección pública de la app, para los enlaces de los correos. Vacía si no se conoce. */
export const APP_URL =
  process.env.APP_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");

export type Email = { from: string; to: string[]; subject: string; html: string; text: string };

/** Lo que Beliapp necesita para mandar correos. Se reemplaza en pruebas. */
export type EmailSender = { send(email: Email): Promise<string> };

export class EmailError extends Error {}

export async function emailConfigured() {
  return Boolean(await credential("RESEND_API_KEY"));
}

/**
 * Remitente de los correos de la empresa: el de Credenciales o, si falta, el que se configuró antes
 * para el resumen semanal. Null si no hay ninguno.
 */
export async function emailFrom(): Promise<string | null> {
  const weekly = await getSetting<{ from?: string }>("weeklyEmail", {});
  const from = (await credential("EMAIL_FROM"))?.trim() || weekly.from?.trim();
  return from && from.includes("@") ? from : null;
}

export const resendSender: EmailSender = {
  async send(email) {
    const key = await credential("RESEND_API_KEY");
    if (!key) throw new EmailError("Falta la clave de Resend en Configuración → Credenciales.");
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
