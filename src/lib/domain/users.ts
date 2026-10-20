import bcrypt from "bcryptjs";
import type { Role } from "@prisma/client";
import { db, rootDb } from "../db";
import { currentCompanyId } from "../tenant";
import { APP_URL, emailConfigured, emailFrom, escapeHtml, resendSender, type EmailSender } from "../email";
import { MIN_PASSWORD_LENGTH } from "./password-reset";

export function renderWelcomeEmail(p: { name: string; email: string; companyName: string; adminName: string; loginUrl: string }) {
  const subject = `Te damos la bienvenida a Beliapp`;
  const text = [
    `Hola ${p.name}:`,
    "",
    `${p.adminName} te creó una cuenta en Beliapp para trabajar en ${p.companyName}.`,
    `Entra con tu correo ${p.email} y la contraseña inicial que te entregó ${p.adminName}:`,
    p.loginUrl,
    "",
    "Si no tienes la contraseña, toca «¿Olvidaste tu contraseña?» en esa pantalla y te mandamos un enlace para elegir una.",
  ].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#0f172a;line-height:1.5">
<p>Hola ${escapeHtml(p.name)}:</p>
<p>${escapeHtml(p.adminName)} te creó una cuenta en Beliapp para trabajar en <strong>${escapeHtml(p.companyName)}</strong>.</p>
<p>Entra con tu correo <strong>${escapeHtml(p.email)}</strong> y la contraseña inicial que te entregó ${escapeHtml(p.adminName)}.</p>
<p><a href="${escapeHtml(p.loginUrl)}" style="display:inline-block;background:#2c8040;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Entrar a Beliapp</a></p>
<p style="color:#475569;font-size:13px">Si no tienes la contraseña, toca «¿Olvidaste tu contraseña?» en esa pantalla y te mandamos un enlace para elegir una.</p>
</div>`;
  return { subject, text, html };
}

export type CreateUserResult = { error: string } | { emailed: boolean };

/**
 * Crea un usuario en la empresa actual y le manda un correo de bienvenida con el enlace para
 * entrar (sin la contraseña). Si el correo falla, el usuario queda creado igual.
 */
export async function createUser(
  input: { name: string; email: string; password: string; role: Role },
  admin: { name: string },
  { sender = resendSender, baseUrl = APP_URL }: { sender?: EmailSender; baseUrl?: string } = {},
): Promise<CreateUserResult> {
  const email = input.email.trim().toLowerCase();
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    return { error: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.` };
  }
  // El correo es único entre todas las empresas.
  if (await rootDb.user.findUnique({ where: { email } })) return { error: "Ya existe un usuario con ese correo." };
  const user = await db.user.create({
    data: { name: input.name.trim(), email, role: input.role, passwordHash: await bcrypt.hash(input.password, 10) },
  });

  if (sender === resendSender && !emailConfigured()) return { emailed: false };
  try {
    const company = await rootDb.company.findUnique({ where: { id: await currentCompanyId() } });
    await sender.send({
      from: emailFrom(),
      to: [user.email],
      ...renderWelcomeEmail({
        name: user.name,
        email: user.email,
        companyName: company?.name ?? "tu empresa",
        adminName: admin.name,
        loginUrl: `${baseUrl.replace(/\/$/, "")}/login`,
      }),
    });
    return { emailed: true };
  } catch (e) {
    console.error("Correo de bienvenida", e);
    return { emailed: false };
  }
}
