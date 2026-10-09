"use server";

import { revalidatePath } from "next/cache";
import { canAccessLead, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseLocalDateTime } from "@/lib/dates";
import { DomainError } from "@/lib/domain/leads";
import { createTask, deleteTask, setTaskDone } from "@/lib/domain/tasks";

function done(leadId: string) {
  revalidatePath("/tasks");
  revalidatePath(`/leads/${leadId}`);
}

/** Un ejecutivo opera las tareas de sus leads y las que tiene asignadas; el admin, todas. */
async function authorizeTask(taskId: string) {
  const user = await requireUser();
  const task = await db.task.findUniqueOrThrow({ where: { id: taskId }, include: { lead: true } });
  if (task.assigneeId !== user.id && !canAccessLead(user, task.lead)) throw new Error("Sin acceso a esta tarea.");
  return { task, by: { actor: "USER" as const, userId: user.id } };
}

export async function createTaskAction(leadId: string, _prev: string | null, form: FormData) {
  const user = await requireUser();
  const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId } });
  if (!canAccessLead(user, lead)) throw new Error("Sin acceso a este lead.");

  const dueAt = parseLocalDateTime(String(form.get("dueAt") ?? ""));
  if (!dueAt) return "Indica la fecha y hora de vencimiento.";
  // Un ejecutivo solo se asigna tareas a sí mismo; el admin elige (vacío = sin asignar).
  const assigneeId = user.role === "ADMIN" ? String(form.get("assigneeId") ?? "") || null : user.id;
  try {
    await createTask(
      leadId,
      { title: String(form.get("title") ?? ""), notes: String(form.get("notes") ?? ""), dueAt, assigneeId },
      { actor: "USER", userId: user.id },
    );
  } catch (e) {
    if (e instanceof DomainError) return e.message;
    throw e;
  }
  done(leadId);
  return null;
}

export async function setTaskDoneAction(taskId: string, isDone: boolean) {
  const { task, by } = await authorizeTask(taskId);
  await setTaskDone(taskId, isDone, by);
  done(task.leadId);
}

export async function deleteTaskAction(taskId: string) {
  const { task, by } = await authorizeTask(taskId);
  await deleteTask(taskId, by);
  done(task.leadId);
}
