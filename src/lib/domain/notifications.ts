import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { deliverPendingPush } from "../push";

type Tx = Prisma.TransactionClient;

export type NotificationType = "HUMAN_STAGE" | "ASSIGNED" | "CONTACT_MESSAGE" | "TASK_DUE";

/**
 * Destinatarios de un aviso del lead: su ejecutivo asignado o, si no tiene (o está
 * inactivo), los administradores activos. Nunca quien provocó el aviso.
 */
async function recipients(tx: Tx, lead: { assigneeId: string | null }, exclude?: string | null) {
  const assignee = lead.assigneeId
    ? await tx.user.findFirst({ where: { id: lead.assigneeId, active: true } })
    : null;
  const users = assignee ? [assignee] : await tx.user.findMany({ where: { role: "ADMIN", active: true } });
  return users.map((u) => u.id).filter((id) => id !== exclude);
}

/**
 * Crea o actualiza el aviso de cada destinatario. Hay a lo más un aviso sin leer por
 * usuario y lead: si ya existe, se reemplaza con el motivo más reciente y vuelve a
 * quedar pendiente de push. El push se envía después de la transacción con
 * `deliverPendingPush`.
 */
async function upsertNotifications(
  tx: Tx,
  leadId: string,
  userIds: string[],
  content: { type: NotificationType; body: string },
) {
  if (userIds.length === 0) return;
  const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId }, include: { contact: true } });
  for (const userId of userIds) {
    const data = { ...content, title: lead.contact.name, pushedAt: null, createdAt: new Date() };
    const unread = await tx.notification.findFirst({ where: { userId, leadId, readAt: null } });
    if (unread) await tx.notification.update({ where: { id: unread.id }, data });
    else await tx.notification.create({ data: { ...data, userId, leadId } });
  }
}

/** El lead entró a una etapa de atención humana (o la IA lo derivó). */
export async function notifyHumanStageTx(tx: Tx, leadId: string, reason?: string | null, by?: string | null) {
  const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId }, include: { stage: true } });
  if (lead.status !== "OPEN") return;
  const body = `Necesita atención humana (${lead.stage.name})${reason ? `: ${reason}` : ""}`;
  await upsertNotifications(tx, leadId, await recipients(tx, lead, by), { type: "HUMAN_STAGE", body });
}

/** El lead se asignó a un ejecutivo. */
export async function notifyAssignedTx(tx: Tx, leadId: string, assigneeId: string, by?: string | null) {
  if (assigneeId === by) return;
  const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId }, include: { stage: true } });
  if (lead.status !== "OPEN") return;
  await upsertNotifications(tx, leadId, [assigneeId], {
    type: "ASSIGNED",
    body: `Te asignaron este lead (${lead.stage.name})`,
  });
}

/**
 * El cliente escribió. Solo avisa si el lead lo atiende un humano: está en una etapa de
 * atención humana o la IA está pausada. Si la IA responde, no hace falta molestar.
 */
export async function notifyContactMessage(leadId: string, body: string) {
  await db.$transaction(async (tx) => {
    const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId }, include: { stage: true } });
    if (lead.status !== "OPEN" || (!lead.stage.requiresHuman && lead.aiEnabled)) return;
    const preview = body.length > 120 ? `${body.slice(0, 119)}…` : body;
    await upsertNotifications(tx, leadId, await recipients(tx, lead), {
      type: "CONTACT_MESSAGE",
      body: `Escribió: «${preview}»`,
    });
  });
  await deliverPendingPush();
}

/**
 * Una tarea del lead está por vencer (o venció). Avisa a su responsable; si no tiene o está
 * inactivo, a quien correspondería un aviso del lead.
 */
export async function notifyTaskDueTx(
  tx: Tx,
  task: { leadId: string; assigneeId: string | null; title: string },
  body: string,
) {
  const lead = await tx.lead.findUniqueOrThrow({ where: { id: task.leadId } });
  const owner = task.assigneeId ? await tx.user.findFirst({ where: { id: task.assigneeId, active: true } }) : null;
  const userIds = owner ? [owner.id] : await recipients(tx, lead);
  await upsertNotifications(tx, task.leadId, userIds, { type: "TASK_DUE", body });
}

/** Abrir un lead marca como leídos sus avisos. */
export async function markLeadNotificationsRead(userId: string, leadId: string) {
  await db.notification.updateMany({ where: { userId, leadId, readAt: null }, data: { readAt: new Date() } });
}

export async function markAllNotificationsRead(userId: string) {
  await db.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
}

export async function unreadNotificationCount(userId: string) {
  return db.notification.count({ where: { userId, readAt: null } });
}
