import type { Role, User } from "@prisma/client";
import { db, rootDb } from "../db";
import { currentCompanyId } from "../tenant";
import { APP_URL, resendSender, type EmailSender } from "../email";
import { sendInvitation, unusablePasswordHash } from "./password-reset";

export type CreateUserResult = { error: string } | { emailed: boolean };

type InviteOptions = { sender?: EmailSender; baseUrl?: string };

async function inviteToCurrentCompany(user: Pick<User, "id" | "name" | "email">, invitedBy: string, { sender = resendSender, baseUrl = APP_URL }: InviteOptions) {
  const company = await rootDb.company.findUnique({ where: { id: await currentCompanyId() } });
  await sendInvitation(user, { companyName: company?.name ?? "tu empresa", invitedBy }, { sender, baseUrl });
}

/**
 * Crea un usuario en la empresa actual, sin contraseña: le llega un correo con el enlace para
 * crearla. Si el correo falla, el usuario queda creado igual y se le puede reenviar.
 */
export async function createUser(
  input: { name: string; email: string; role: Role },
  admin: { name: string },
  options: InviteOptions = {},
): Promise<CreateUserResult> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!name) return { error: "Escribe el nombre." };
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: "Escribe un correo válido." };
  // El correo es único entre todas las empresas.
  if (await rootDb.user.findUnique({ where: { email } })) return { error: "Ya existe un usuario con ese correo." };
  const user = await db.user.create({ data: { name, email, role: input.role, passwordHash: await unusablePasswordHash() } });
  try {
    await inviteToCurrentCompany(user, admin.name, options);
    return { emailed: true };
  } catch (e) {
    console.error("Invitación", e);
    return { emailed: false };
  }
}

/** Vuelve a mandar el correo para crear la contraseña (el enlace anterior deja de valer). */
export async function resendInvitation(id: string, admin: { name: string }, options: InviteOptions = {}): Promise<string | null> {
  const user = await db.user.findFirst({ where: { id, deletedAt: null } });
  if (!user) return "Ese usuario ya no existe.";
  if (!user.active) return "Activa al usuario antes de invitarlo.";
  try {
    await inviteToCurrentCompany(user, admin.name, options);
    return null;
  } catch (e) {
    console.error("Invitación", e);
    return "No se pudo mandar el correo. Inténtalo de nuevo en unos minutos.";
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
