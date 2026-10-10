"use client";

import { useActionState } from "react";
import type { AiOperationSettings } from "@/lib/domain/ai-operation";
import { CardHeader, Field, FormMessage, inputClass } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { saveAiOperationAction } from "./actions";

const checkClass = "size-4 rounded border-slate-300 accent-brand-600";
// Lunes primero; el valor es el día de la semana (0 = domingo).
const DAYS: [number, string][] = [[1, "Lu"], [2, "Ma"], [3, "Mi"], [4, "Ju"], [5, "Vi"], [6, "Sá"], [0, "Do"]];

export function AiOperationForm({
  settings: s,
  status,
  previousTicketsCount,
}: {
  settings: AiOperationSettings;
  status: string | null;
  previousTicketsCount: number;
}) {
  const [message, action] = useActionState(saveAiOperationAction, null);
  return (
    <form action={action} className="space-y-6">
      <section className="space-y-4">
        <CardHeader
          title="Horario de atención"
          description={status ?? "Sin horario: la IA responde a cualquier hora."}
        />
        <label className="flex min-h-10 items-center gap-2 text-sm font-medium text-slate-800">
          <input type="checkbox" name="hoursEnabled" defaultChecked={s.hoursEnabled} className={checkClass} />
          Responder solo dentro del horario de atención
        </label>
        <fieldset>
          <legend className="text-sm font-medium text-slate-800">Días</legend>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {DAYS.map(([value, label]) => (
              <label key={value} className="flex min-h-10 items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" name="days" value={value} defaultChecked={s.days.includes(value)} className={checkClass} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Desde (hora)" hint="Hora de Chile">
            <input name="from" type="number" min={0} max={23} required defaultValue={s.from} className={inputClass} />
          </Field>
          <Field label="Hasta (hora)" hint="Si es menor que la de inicio, el horario cruza la medianoche">
            <input name="to" type="number" min={0} max={24} required defaultValue={s.to} className={inputClass} />
          </Field>
        </div>
        <fieldset>
          <legend className="text-sm font-medium text-slate-800">Fuera de horario</legend>
          <div className="mt-1 space-y-1">
            <label className="flex min-h-10 items-center gap-2 text-sm text-slate-700">
              <input type="radio" name="outOfHours" value="message" defaultChecked={s.outOfHours === "message"} className="size-4 accent-brand-600" />
              Enviar un mensaje automático (una vez cada 12 horas por cliente)
            </label>
            <label className="flex min-h-10 items-center gap-2 text-sm text-slate-700">
              <input type="radio" name="outOfHours" value="silent" defaultChecked={s.outOfHours === "silent"} className="size-4 accent-brand-600" />
              No responder
            </label>
          </div>
        </fieldset>
        <Field label="Mensaje fuera de horario">
          <textarea name="outOfHoursMessage" rows={3} defaultValue={s.outOfHoursMessage} className={inputClass} />
        </Field>
        <p className="text-xs text-slate-600">
          Al abrir el horario, la IA responde lo que los clientes escribieron mientras estaba cerrado (se revisa cada 15
          minutos). Los seguimientos usan su propio horario, en Configuración → Seguimientos.
        </p>
      </section>
      <section className="space-y-3 border-t border-slate-100 pt-5">
        <CardHeader title="Contexto" />
        <label className="flex min-h-10 items-center gap-2 text-sm font-medium text-slate-800">
          <input type="checkbox" name="previousTickets" defaultChecked={s.previousTickets} className={checkClass} />
          Darle a la IA un resumen de los últimos {previousTicketsCount} tickets cerrados del contacto
        </label>
        <p className="text-xs text-slate-600">
          Así, si un cliente que ya compró o consultó antes vuelve a escribir, la asistente sabe cómo terminó cada
          conversación (ganada o perdida, motivo, monto y resumen) y no parte de cero.
        </p>
      </section>
      <div className="flex items-center gap-3">
        <SubmitButton>Guardar</SubmitButton>
        {message && <FormMessage tone={message === "Guardado." ? "neutral" : "danger"}>{message}</FormMessage>}
      </div>
    </form>
  );
}
