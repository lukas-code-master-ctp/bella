import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "../db";
import { emailConfigured, escapeHtml, resendSender, type EmailSender } from "../email";
import { getWeeklyEmailSettings } from "./weekly-email";

/**
 * Recuperación de contraseña por correo: un enlace de un solo uso que vence en una hora. Se guarda
 * solo el hash del token, así que un respaldo de la base no sirve para entrar.
 */
export const RESET_TTL_MS = 60 * 60 * 1000;
/** Evita mandar varios correos seguidos a la misma persona si aprieta el botón muchas veces. */
const RESEND_COOLDOWN_MS = 60 * 1000;
export const MIN_PASSWORD_LENGTH = 8;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Remitente de los correos de la cuenta: EMAIL_FROM si está en el servidor; si no, el que la
 * empresa configuró para el resumen semanal (un dominio verificado en Resend).
 */
export async function accountEmailFrom(): Promise<string | null> {
  const from = process.env.EMAIL_FROM?.trim() || (await getWeeklyEmailSettings()).from.trim();
  return from.includes("@") ? from : null;
}

/** Si el servidor puede mandar el correo de recuperación. */
export async function passwordResetAvailable(sender: EmailSender = resendSender) {
  if (sender === resendSender && !emailConfigured()) return false;
  return (await accountEmailFrom()) != null;
}

export function renderPasswordResetEmail({ name, link }: { name: string; link: string }) {
  const subject = "Restablece tu contraseña";
  const text = [
    `Hola ${name}:`,
    "",
    "Pediste restablecer tu contraseña. Abre este enlace para elegir una nueva (vence en 1 hora y sirve una sola vez):",
    link,
    "",
    "Si no fuiste tú, ignora este correo: tu contraseña no cambia.",
  ].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#0f172a;line-height:1.5">
<p>Hola ${escapeHtml(name)}:</p>
<p>Pediste restablecer tu contraseña. Toca el botón para elegir una nueva. El enlace vence en 1 hora y sirve una sola vez.</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Elegir nueva contraseña</a></p>
<p style="color:#475569;font-size:13px">Si el botón no funciona, copia este enlace: ${escapeHtml(link)}</p>
<p style="color:#475569;font-size:13px">Si no fuiste tú, ignora este correo: tu contraseña no cambia.</p>
</div>`;
  return { subject, text, html };
}

/**
 * Crea un enlace y lo manda por correo si existe un usuario activo con esa dirección. No dice si
 * el correo existe (la pantalla muestra siempre el mismo mensaje). `baseUrl` es el origen de la app.
 */
export async function requestPasswordReset(
  email: string,
  baseUrl: string,
  { sender = resendSender, now = new Date() }: { sender?: EmailSender; now?: Date } = {},
): Promise<void> {
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user?.active) return;
  const recent = await db.passwordResetToken.findFirst({
    where: { userId: user.id, createdAt: { gt: new Date(now.getTime() - RESEND_COOLDOWN_MS) } },
  });
  if (recent) return;
  const from = await accountEmailFrom();
  if (!from) throw new Error("Falta el remitente de correos (EMAIL_FROM o el del resumen semanal).");

  const token = randomBytes(32).toString("base64url");
  // Un enlace nuevo deja sin efecto los anteriores.
  await db.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } });
  await db.passwordResetToken.create({
    data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + RESET_TTL_MS), createdAt: now },
  });
  const link = `${baseUrl.replace(/\/$/, "")}/login/restablecer?token=${token}`;
  await sender.send({ from, to: [user.email], ...renderPasswordResetEmail({ name: user.name, link }) });
}

/** Token vigente (sin usar y sin vencer) de un usuario activo, o null. */
async function validToken(token: string, now: Date) {
  if (!token) return null;
  const row = await db.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!row || row.usedAt || row.expiresAt <= now || !row.user.active) return null;
  return row;
}

export async function passwordResetTokenValid(token: string, now = new Date()) {
  return (await validToken(token, now)) != null;
}

export type ResetResult = { ok: true; email: string } | { ok: false; error: string };

/** Cambia la contraseña con un enlace vigente, lo gasta y cierra las sesiones abiertas. */
export async function resetPassword(token: string, password: string, now = new Date()): Promise<ResetResult> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.` };
  }
  const row = await validToken(token, now);
  if (!row) return { ok: false, error: "El enlace no es válido o ya venció. Pide uno nuevo." };
  const passwordHash = await bcrypt.hash(password, 10);
  // Se marca usado solo si nadie lo gastó entre la lectura y ahora (dos envíos simultáneos).
  const spent = await db.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
  if (spent.count === 0) return { ok: false, error: "El enlace no es válido o ya venció. Pide uno nuevo." };
  await db.$transaction([
    db.user.update({ where: { id: row.userId }, data: { passwordHash, passwordChangedAt: now } }),
    db.passwordResetToken.updateMany({ where: { userId: row.userId, usedAt: null }, data: { usedAt: now } }),
  ]);
  return { ok: true, email: row.user.email };
}
