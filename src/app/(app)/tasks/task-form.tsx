"use client";

import { useActionState } from "react";
import { Plus } from "lucide-react";
import { FormMessage, inputClass } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { createTaskAction } from "./actions";

/** Formulario para agregar una tarea a un lead. `executives` solo se pasa al admin. */
export function TaskForm({
  leadId,
  defaultDue,
  executives,
  defaultAssigneeId,
}: {
  leadId: string;
  /** "AAAA-MM-DDTHH:MM" en hora de Chile, calculado en el servidor. */
  defaultDue: string;
  executives?: { id: string; name: string }[];
  defaultAssigneeId?: string | null;
}) {
  const [error, action] = useActionState(createTaskAction.bind(null, leadId), null);
  // React limpia el formulario al terminar la acción, listo para la siguiente tarea.
  return (
    <form action={action} className="space-y-2">
      <input name="title" required maxLength={200} aria-label="Nueva tarea" placeholder="Nueva tarea, ej. Llamar para confirmar visita" className={inputClass} />
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
        <input
          type="datetime-local"
          name="dueAt"
          required
          aria-label="Vence"
          defaultValue={defaultDue}
          className={inputClass}
        />
        {executives && (
          <select name="assigneeId" aria-label="Responsable" defaultValue={defaultAssigneeId ?? ""} className={inputClass}>
            <option value="">Sin asignar</option>
            {executives.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <textarea name="notes" rows={2} aria-label="Notas" placeholder="Notas (opcional)" className={inputClass} />
      {error && <FormMessage>{error}</FormMessage>}
      <SubmitButton variant="secondary" className="w-full">
        <Plus aria-hidden />
        Agregar tarea
      </SubmitButton>
    </form>
  );
}
