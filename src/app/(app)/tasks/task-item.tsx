import Link from "next/link";
import { Bot, Check, ChevronDown, Trash2 } from "lucide-react";
import type { Task } from "@prisma/client";
import { formatDue, formatLocal } from "@/lib/dates";
import { bucketOf } from "@/lib/domain/tasks";
import { SubmitButton } from "@/components/submit-button";
import { deleteTaskAction, setTaskDoneAction } from "./actions";

const DUE_TONE = {
  overdue: "text-rose-700 font-semibold",
  today: "text-amber-800 font-semibold",
  upcoming: "text-slate-600",
};

/**
 * Una tarea como tarjeta compacta: título, lead, vencimiento, responsable y si la creó la IA.
 * Al hacer clic se despliega con la descripción completa y el botón de eliminar.
 * `lead` muestra a qué lead pertenece (en "Mis tareas"); en la ficha del lead se omite.
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
    <li className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-2 transition-colors duration-150 hover:border-slate-300">
      <form action={setTaskDoneAction.bind(null, task.id, !isDone)}>
        <SubmitButton
          variant="ghost"
          size="icon"
          pendingText=""
          aria-label={isDone ? `Marcar "${task.title}" como pendiente` : `Marcar "${task.title}" como cumplida`}
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
      <details className="group min-w-0 flex-1">
        <summary className="flex cursor-pointer list-none items-start gap-2 rounded-md py-1.5 pr-1 [&::-webkit-details-marker]:hidden">
          <div className="min-w-0 flex-1">
            <p
              className={`line-clamp-2 text-sm font-medium [overflow-wrap:anywhere] group-open:line-clamp-none ${
                isDone ? "text-slate-500 line-through" : "text-slate-900"
              }`}
            >
              {task.title}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-600">
              {lead && <span className="max-w-full truncate font-medium text-brand-700">{lead.name}</span>}
              <span className={isDone ? "" : DUE_TONE[bucket]}>{isDone ? "Cumplida" : formatDue(task.dueAt, now)}</span>
              {assigneeName !== undefined && <span className="truncate">{assigneeName ?? "Sin asignar"}</span>}
              {task.createdBy === "AI" && (
                <span className="inline-flex items-center gap-1 text-brand-700" title="Creada por la IA">
                  <Bot aria-hidden className="size-3.5" />
                  IA
                </span>
              )}
            </p>
          </div>
          <ChevronDown
            aria-hidden
            className="mt-0.5 size-4 shrink-0 text-slate-400 transition-transform duration-150 group-open:rotate-180"
          />
        </summary>
        <div className="space-y-2 border-t border-slate-100 pb-1 pr-1 pt-2">
          {task.notes ? (
            // Notas largas (las de la IA suelen serlo) quedan en 4 líneas; un clic las muestra completas.
            <details className="group/notes">
              <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                <p className="line-clamp-4 whitespace-pre-line text-xs text-slate-700 [overflow-wrap:anywhere] group-open/notes:line-clamp-none">
                  {task.notes}
                </p>
                {task.notes.length > 160 && (
                  <span className="mt-0.5 inline-block text-xs font-medium text-brand-700 hover:underline">
                    <span className="group-open/notes:hidden">Ver más</span>
                    <span className="hidden group-open/notes:inline">Ver menos</span>
                  </span>
                )}
              </summary>
            </details>
          ) : (
            <p className="text-xs text-slate-500">Sin descripción.</p>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            <dt className="text-slate-500">Vence</dt>
            <dd className="text-slate-700">{formatLocal(task.dueAt)}</dd>
            <dt className="text-slate-500">Creada</dt>
            <dd className="text-slate-700">
              {formatLocal(task.createdAt)}
              {task.createdBy === "AI" ? " por la IA" : ""}
            </dd>
            {isDone && (
              <>
                <dt className="text-slate-500">Cumplida</dt>
                <dd className="text-slate-700">{formatLocal(task.completedAt!)}</dd>
              </>
            )}
          </dl>
          <div className="flex items-center gap-2">
            {lead && (
              <Link href={`/leads/${lead.id}`} className="text-xs font-medium text-brand-700 hover:underline">
                Abrir lead
              </Link>
            )}
            <form action={deleteTaskAction.bind(null, task.id)} className="ml-auto">
              <SubmitButton
                toast="Tarea eliminada"
                variant="ghost"
                size="sm"
                pendingText="Eliminando…"
                confirm={`¿Eliminar la tarea "${task.title}"?`}
                className="text-slate-500 hover:!text-rose-700"
              >
                <Trash2 aria-hidden />
                Eliminar
              </SubmitButton>
            </form>
          </div>
        </div>
      </details>
    </li>
  );
}
