"use client";

import { useActionState, useState } from "react";
import type { FieldType } from "@prisma/client";
import { Plus } from "lucide-react";
import { Field, FormMessage, inputClass } from "@/components/ui";
import { Chip } from "@/components/settings-ui";
import { SubmitButton } from "@/components/submit-button";
import { FIELD_TYPE_LABEL } from "@/lib/labels";
import { createFieldAction, updateFieldAction } from "./actions";

type FieldData = { id: string; name: string; type: FieldType; options: string[]; description: string };

/** Formulario de un campo del cliente: sin `field` crea uno nuevo. */
export function FieldForm({ field }: { field?: FieldData }) {
  const [message, action] = useActionState(field ? updateFieldAction.bind(null, field.id) : createFieldAction, null);
  const [type, setType] = useState<FieldType>(field?.type ?? "TEXT");
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre">
          <input name="name" required defaultValue={field?.name} placeholder="Ej. Presupuesto" className={inputClass} />
        </Field>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium text-slate-800">Tipo</legend>
          <div className="flex flex-wrap gap-2">
            {(Object.entries(FIELD_TYPE_LABEL) as [FieldType, string][]).map(([value, label]) => (
              <Chip key={value} type="radio" name="type" value={value} checked={type === value} onChange={() => setType(value)}>
                {label}
              </Chip>
            ))}
          </div>
        </fieldset>
      </div>
      {type === "OPTIONS" && (
        <Field label="Opciones" hint="Separadas por coma">
          <input name="options" required defaultValue={field?.options.join(", ")} placeholder="Sí, No" className={inputClass} />
        </Field>
      )}
      <Field label="Indicación para la IA" hint="Qué guardar y cuándo preguntarlo. La IA la lee en cada turno.">
        <textarea
          name="description"
          rows={2}
          defaultValue={field?.description}
          placeholder="Ej. Presupuesto total en pesos. Pregúntalo solo cuando ya conozca el plazo y la forma de pago."
          className={inputClass}
        />
      </Field>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {message && <FormMessage tone={message === "Guardado." ? "neutral" : "danger"}>{message}</FormMessage>}
        {field ? (
          <SubmitButton>Guardar cambios</SubmitButton>
        ) : (
          <SubmitButton>
            <Plus aria-hidden />
            Agregar campo
          </SubmitButton>
        )}
      </div>
    </form>
  );
}
