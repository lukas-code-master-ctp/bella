import Link from "next/link";
import { Bot, Check, Trash2 } from "lucide-react";
import type { Task } from "@prisma/client";
import { formatDue } from "@/lib/dates";
import { bucketOf } from "@/lib/domain/tasks";
import { SubmitButton } from "@/components/submit-button";
import { deleteTaskAction, setTaskDoneAction } from "./actions";

const DUE_TONE = {
  overdue: "text-rose-700 font-semibold",
  today: "text-amber-800 font-semibold",
  upcoming: "text-slate-600",
};

/**
 * Una tarea con su casilla para marcarla cumplida. `lead` muestra a qué lead pertenece
 * (en "Mis tareas"); en la ficha del lead se omite.
 */
export function TaskItem({
  task,
  now,
  lead,
  assigneeName,
}: {
  task: Task;
  now: Date;
  lead?: { id: string; name: string };
  assigneeName?: string | null;
}) {
  const isDone = task.completedAt !== null;
  const bucket = bucketOf(task.dueAt, now);
  return (
    <li className="flex items-start gap-3 py-3">
      <form action={setTaskDoneAction.bind(null, task.id, !isDone)}>
        <SubmitButton
          variant="ghost"
          size="icon"
          pendingText=""
          aria-label={isDone ? `Marcar "${task.title}" como pendiente` : `Marcar "${task.title}" como cumplida`}
          className="-my-1.5 -ml-2"
        >
          <span
            aria-hidden
            className={`flex size-5 items-center justify-center rounded-md border-2 transition-colors duration-150 ${
              isDone ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-400 bg-white"
            }`}
          >
            {isDone && <Check className="!size-3.5 animate-pop" strokeWidth={3} />}
          </span>
        </SubmitButton>
      </form>
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium ${isDone ? "text-slate-500 line-through" : "text-slate-900"}`}>{task.title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-600">
          {lead && (
            <Link href={`/leads/${lead.id}`} className="font-medium text-brand-700 hover:underline">
              {lead.name}
            </Link>
          )}
          <span className={isDone ? "" : DUE_TONE[bucket]}>
            {isDone ? "Cumplida" : formatDue(task.dueAt, now)}
          </span>
          {assigneeName !== undefined && <span>{assigneeName ?? "Sin asignar"}</span>}
          {task.createdBy === "AI" && (
            <span className="inline-flex items-center gap-1 text-brand-700">
              <Bot aria-hidden className="size-3.5" />
              Creada por la IA
            </span>
          )}
        </p>
        {task.notes && <p className="mt-1 whitespace-pre-line text-xs text-slate-700">{task.notes}</p>}
      </div>
      <form action={deleteTaskAction.bind(null, task.id)}>
        <SubmitButton
          variant="ghost"
          size="icon"
          pendingText=""
          confirm={`¿Eliminar la tarea "${task.title}"?`}
          aria-label={`Eliminar tarea "${task.title}"`}
          className="-my-1.5 text-slate-400 hover:!text-rose-700"
        >
          <Trash2 aria-hidden />
        </SubmitButton>
      </form>
    </li>
  );
}
