import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { startOfLocalDay } from "../dates";
import { DomainError, type ActorRef } from "./leads";

type Tx = Prisma.TransactionClient;

export type TaskInput = {
  title: string;
  dueAt: Date;
  notes?: string | null;
  /** Sin indicar, la tarea queda para el ejecutivo del lead (o sin asignar si no tiene). */
  assigneeId?: string | null;
};

export async function createTask(leadId: string, input: TaskInput, by: ActorRef) {
  return db.$transaction((tx) => createTaskTx(tx, leadId, input, by));
}

export async function createTaskTx(tx: Tx, leadId: string, input: TaskInput, by: ActorRef) {
  const title = input.title.trim();
  if (!title) throw new DomainError("Escribe qué hay que hacer.");
  if (title.length > 200) throw new DomainError("El título es muy largo (máximo 200 caracteres).");
  if (Number.isNaN(input.dueAt.getTime())) throw new DomainError("Indica una fecha de vencimiento válida.");

  const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
  const assigneeId = input.assigneeId === undefined ? lead.assigneeId : input.assigneeId;
  const assignee = assigneeId ? await tx.user.findUnique({ where: { id: assigneeId } }) : null;
  if (assigneeId && !assignee?.active) throw new DomainError("El ejecutivo indicado no existe o está inactivo.");

  const task = await tx.task.create({
    data: {
      leadId,
      title,
      notes: input.notes?.trim() || null,
      dueAt: input.dueAt,
      assigneeId: assignee?.id ?? null,
      createdBy: by.actor,
      createdById: by.userId ?? null,
    },
  });
  await tx.leadEvent.create({
    data: {
      leadId,
      type: "TASK_CREATED",
      actor: by.actor,
      userId: by.userId ?? null,
      data: { taskId: task.id, title, dueAt: task.dueAt.toISOString(), assigneeName: assignee?.name ?? null },
    },
  });
  return task;
}

/** Marca una tarea como cumplida o la vuelve a dejar pendiente. */
export async function setTaskDone(taskId: string, done: boolean, by: ActorRef) {
  return db.$transaction(async (tx) => {
    const task = await tx.task.findUniqueOrThrow({ where: { id: taskId } });
    if (done === (task.completedAt !== null)) return task;
    const updated = await tx.task.update({ where: { id: taskId }, data: { completedAt: done ? new Date() : null } });
    await tx.leadEvent.create({
      data: {
        leadId: task.leadId,
        type: done ? "TASK_DONE" : "TASK_REOPENED",
        actor: by.actor,
        userId: by.userId ?? null,
        data: { taskId, title: task.title },
      },
    });
    return updated;
  });
}

export async function deleteTask(taskId: string, by: ActorRef) {
  return db.$transaction(async (tx) => {
    const task = await tx.task.delete({ where: { id: taskId } });
    await tx.leadEvent.create({
      data: {
        leadId: task.leadId,
        type: "TASK_DELETED",
        actor: by.actor,
        userId: by.userId ?? null,
        data: { taskId, title: task.title },
      },
    });
  });
}

/**
 * Al cambiar el ejecutivo de un lead, sus tareas pendientes pasan al nuevo: las del ejecutivo
 * anterior y las que estaban sin asignar. Las asignadas a propósito a otra persona se quedan.
 */
export async function moveOpenTasksTx(tx: Tx, leadId: string, fromId: string | null, toId: string | null) {
  if (fromId === toId) return;
  await tx.task.updateMany({
    where: {
      leadId,
      completedAt: null,
      OR: [{ assigneeId: null }, ...(fromId ? [{ assigneeId: fromId }] : [])],
    },
    data: { assigneeId: toId },
  });
}

export type TaskBucket = "overdue" | "today" | "upcoming";

/** Vencida (pasó el plazo), para hoy (vence antes de medianoche en Chile) o próxima. */
export function bucketOf(dueAt: Date, now: Date): TaskBucket {
  if (dueAt < now) return "overdue";
  return dueAt < startOfLocalDay(now, 1) ? "today" : "upcoming";
}

const taskInclude = {
  lead: { select: { id: true, status: true, contact: { select: { name: true } } } },
  assignee: { select: { id: true, name: true } },
} satisfies Prisma.TaskInclude;

export type TaskWithLead = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

/**
 * Tareas para la vista "Mis tareas": pendientes agrupadas por plazo y las cumplidas en los
 * últimos 7 días. `assigneeId` undefined = de todos; null = sin asignar.
 */
export async function listTasks(assigneeId: string | null | undefined, now = new Date()) {
  const scope: Prisma.TaskWhereInput = assigneeId === undefined ? {} : { assigneeId };
  const [pending, done] = await Promise.all([
    db.task.findMany({ where: { ...scope, completedAt: null }, include: taskInclude, orderBy: { dueAt: "asc" } }),
    db.task.findMany({
      where: { ...scope, completedAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } },
      include: taskInclude,
      orderBy: { completedAt: "desc" },
      take: 30,
    }),
  ]);
  const groups: Record<TaskBucket, TaskWithLead[]> = { overdue: [], today: [], upcoming: [] };
  for (const t of pending) groups[bucketOf(t.dueAt, now)].push(t);
  return { ...groups, done };
}

/** Tareas pendientes de un ejecutivo vencidas o que vencen hoy (contador del menú). */
export async function countUrgentTasks(assigneeId: string, now = new Date()) {
  return db.task.count({ where: { assigneeId, completedAt: null, dueAt: { lt: startOfLocalDay(now, 1) } } });
}

/**
 * Para avisos: tareas pendientes cuyo plazo cae en (`since`, `until`], con su lead y ejecutivo.
 * Llamarla con ventanas consecutivas (ej. desde la última revisión hasta ahora + anticipación)
 * entrega cada tarea una sola vez.
 */
export async function findDueTasks(until: Date, since?: Date) {
  return db.task.findMany({
    where: { completedAt: null, dueAt: { lte: until, ...(since ? { gt: since } : {}) } },
    include: {
      lead: { select: { id: true, status: true, contact: { select: { name: true } } } },
      assignee: { select: { id: true, name: true, email: true } },
    },
    orderBy: { dueAt: "asc" },
  });
}
