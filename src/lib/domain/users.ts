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

/** Debe quedar al menos un admin activo en la empresa, o nadie podría entrar a Configuración. */
async function lastActiveAdmin(userId: string) {
  const others = await db.user.count({ where: { role: "ADMIN", active: true, deletedAt: null, id: { not: userId } } });
  return others === 0;
}

/** Edita nombre, correo y perfil de un usuario de la empresa. Devuelve un error para mostrar o null. */
export async function updateUser(id: string, input: { name: string; email: string; role: Role }, by: { id: string }): Promise<string | null> {
  const user = await db.user.findFirst({ where: { id, deletedAt: null } });
  if (!user) return "Ese usuario ya no existe.";
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name) return "Escribe el nombre.";
  if (!/^\S+@\S+\.\S+$/.test(email)) return "Escribe un correo válido.";
  if (email !== user.email && (await rootDb.user.findUnique({ where: { email } }))) return "Ya existe un usuario con ese correo.";
  if (input.role !== user.role && user.role === "ADMIN") {
    if (id === by.id) return "No puedes quitarte el perfil de admin a ti mismo.";
    if (await lastActiveAdmin(id)) return "Debe quedar al menos un admin activo.";
  }
  await db.user.update({
    where: { id },
    // Un ejecutivo no usa "Atiende leads": ya los recibe.
    data: { name, email, role: input.role, ...(input.role === "EXECUTIVE" ? { takesLeads: false } : {}) },
  });
  return null;
}

/**
 * Elimina un usuario. Se conserva por el historial (sus mensajes y eventos siguen mostrando su
 * nombre), pero deja de aparecer y de poder entrar, y su correo queda libre. Sus leads y tareas
 * abiertas quedan sin asignar.
 */
export async function deleteUser(id: string, by: { id: string }): Promise<string | null> {
  if (id === by.id) return "No puedes eliminarte a ti mismo.";
  const user = await db.user.findFirst({ where: { id, deletedAt: null } });
  if (!user) return "Ese usuario ya no existe.";
  if (user.role === "ADMIN" && user.active && (await lastActiveAdmin(id))) return "Debe quedar al menos un admin activo.";
  await db.$transaction(async (tx) => {
    const leads = await tx.lead.findMany({ where: { assigneeId: id, status: "OPEN" }, select: { id: true } });
    await tx.lead.updateMany({ where: { id: { in: leads.map((l) => l.id) } }, data: { assigneeId: null } });
    await tx.leadEvent.createMany({
      data: leads.map((l) => ({ leadId: l.id, type: "UNASSIGNED", actor: "USER" as const, userId: by.id, reason: `Se eliminó a ${user.name}` })),
    });
    await tx.task.updateMany({ where: { assigneeId: id, completedAt: null }, data: { assigneeId: null } });
    await tx.assignmentRule.updateMany({ where: { lastAssignedUserId: id }, data: { lastAssignedUserId: null } });
    for (const rule of await tx.assignmentRule.findMany({ where: { executives: { some: { id } } }, select: { id: true } })) {
      await tx.assignmentRule.update({ where: { id: rule.id }, data: { executives: { disconnect: { id } } } });
    }
    await tx.pushSubscription.deleteMany({ where: { userId: id } });
    await tx.notification.deleteMany({ where: { userId: id } });
    await tx.user.update({
      where: { id },
      data: { active: false, takesLeads: false, deletedAt: new Date(), sessionsRevokedAt: new Date(), email: `eliminado-${id}@usuarios.beliapp.invalid` },
    });
  });
  return null;
}
