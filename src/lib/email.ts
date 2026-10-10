/**
 * Envío de correos con Resend (https://resend.com), por su API HTTP. Credencial en la variable
 * de entorno RESEND_API_KEY; el remitente (de un dominio verificado en Resend) se configura en la
 * app, porque es propio de cada empresa.
 */

export type Email = { from: string; to: string[]; subject: string; html: string; text: string };

/** Lo que Bella necesita para mandar correos. Se reemplaza en pruebas. */
export type EmailSender = { send(email: Email): Promise<string> };

export class EmailError extends Error {}

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

export const resendSender: EmailSender = {
  async send(email) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new EmailError("Falta RESEND_API_KEY en las variables de entorno.");
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
