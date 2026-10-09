"use client";

import { useActionState, useState } from "react";
import type { FieldType } from "@prisma/client";
import { Plus } from "lucide-react";
import { Field, FormMessage, inputClass } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { FIELD_TYPE_LABEL } from "@/lib/labels";
import { createFieldAction, updateFieldAction } from "./actions";

type FieldData = { id: string; name: string; type: FieldType; options: string[]; description: string };

/** Formulario de un campo del cliente: sin `field` crea uno nuevo. */
export function FieldForm({ field }: { field?: FieldData }) {
  const [message, action] = useActionState(field ? updateFieldAction.bind(null, field.id) : createFieldAction, null);
  const [type, setType] = useState<FieldType>(field?.type ?? "TEXT");
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
      <Field label="Nombre">
        <input name="name" required defaultValue={field?.name} placeholder="Ej. Presupuesto" className={inputClass} />
      </Field>
      <Field label="Tipo">
        <select name="type" value={type} onChange={(e) => setType(e.target.value as FieldType)} className={inputClass}>
          {Object.entries(FIELD_TYPE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      {type === "OPTIONS" && (
        <div className="sm:col-span-2">
          <Field label="Opciones" hint="Separadas por coma">
            <input name="options" required defaultValue={field?.options.join(", ")} placeholder="Sí, No" className={inputClass} />
          </Field>
        </div>
      )}
      <div className="sm:col-span-2">
        <Field label="Indicación para la IA" hint="Qué guardar y cuándo preguntarlo. La IA la lee en cada turno.">
          <textarea
            name="description"
            rows={2}
            defaultValue={field?.description}
            placeholder="Ej. Presupuesto total en pesos. Pregúntalo solo cuando ya conozca el plazo y la forma de pago."
            className={inputClass}
          />
        </Field>
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        {field ? (
          <SubmitButton variant="secondary">Guardar</SubmitButton>
        ) : (
          <SubmitButton>
            <Plus aria-hidden />
            Agregar campo
          </SubmitButton>
        )}
        {message && <FormMessage tone={message === "Guardado." ? "neutral" : "danger"}>{message}</FormMessage>}
      </div>
    </form>
  );
}
