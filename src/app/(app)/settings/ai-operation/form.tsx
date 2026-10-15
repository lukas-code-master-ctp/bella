"use client";

import { useActionState } from "react";
import { Ban, BellOff, CalendarClock, History, MessageSquareText } from "lucide-react";
import type { AiOperationSettings } from "@/lib/domain/ai-operation";
import { Field, FormMessage, inputClass } from "@/components/ui";
import { Callout, ChoiceCard, Chip, FieldGroup, HourSelect, Panel, PanelBody, SaveBar, ToggleRow } from "@/components/settings-ui";
import { SubmitButton } from "@/components/submit-button";
import { saveAiOperationAction } from "./actions";
import { isSaved, savedToast, withToast } from "@/components/toast";

// Lunes primero; el valor es el día de la semana (0 = domingo).
const DAYS: [number, string][] = [[1, "Lun"], [2, "Mar"], [3, "Mié"], [4, "Jue"], [5, "Vie"], [6, "Sáb"], [0, "Dom"]];

export function AiOperationForm({
  settings: s,
  status,
  previousTicketsCount,
}: {
  settings: AiOperationSettings;
  status: string | null;
  previousTicketsCount: number;
}) {
  const [message, action] = useActionState(withToast(saveAiOperationAction, savedToast), null);
  return (
    <form action={action} className="space-y-6">
      <Panel icon={<CalendarClock />} title="Horario de atención" description={status ?? "Sin horario: la IA responde a cualquier hora."}>
        <PanelBody>
          <ToggleRow
            name="hoursEnabled"
            defaultChecked={s.hoursEnabled}
            title="Responder solo dentro del horario"
            description="Fuera de él, la IA espera o deja un mensaje automático."
          />
          <FieldGroup title="Días de atención">
            <div className="flex flex-wrap gap-2">
              {DAYS.map(([value, label]) => (
                <Chip key={value} name="days" value={value} defaultChecked={s.days.includes(value)}>
                  {label}
                </Chip>
              ))}
            </div>
          </FieldGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Desde" hint="Hora de Chile">
              <HourSelect name="from" max={23} defaultValue={s.from} className={inputClass} />
            </Field>
            <Field label="Hasta" hint="Si es antes que la de inicio, el horario cruza la medianoche">
              <HourSelect name="to" max={24} defaultValue={s.to} className={inputClass} />
            </Field>
          </div>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium text-slate-800">Fuera de horario</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <ChoiceCard
                name="outOfHours"
                value="message"
                defaultChecked={s.outOfHours === "message"}
                icon={<MessageSquareText />}
                title="Enviar un mensaje automático"
                description="Una vez cada 12 horas por cliente."
              />
              <ChoiceCard
                name="outOfHours"
                value="silent"
                defaultChecked={s.outOfHours === "silent"}
                icon={<BellOff />}
                title="No responder"
                description="El mensaje queda esperando hasta que abra el horario."
              />
            </div>
          </fieldset>
          <Field label="Mensaje fuera de horario">
            <textarea name="outOfHoursMessage" rows={3} defaultValue={s.outOfHoursMessage} className={inputClass} />
          </Field>
          <Callout tone="neutral">
            Al abrir el horario, la IA responde lo que los clientes escribieron mientras estaba cerrado (se revisa cada 15
            minutos). Los seguimientos usan su propio horario, en Configuración → Seguimientos.
          </Callout>
        </PanelBody>
      </Panel>

      <Panel icon={<History />} title="Contexto del cliente">
        <PanelBody>
          <ToggleRow
            name="previousTickets"
            defaultChecked={s.previousTickets}
            title={`Recordar los últimos ${previousTicketsCount} tickets cerrados`}
            description="Si un cliente que ya compró o consultó vuelve a escribir, la asistente sabe cómo terminó cada conversación (ganada o perdida, motivo, monto y resumen) y no parte de cero."
          />
        </PanelBody>
      </Panel>

      <Panel icon={<Ban />} title="Bloqueo automático">
        <PanelBody>
          <ToggleRow
            name="autoBlock"
            defaultChecked={s.autoBlock}
            title="Permitir que la IA bloquee contactos"
            description="Si una conversación cumple uno de los criterios, la asistente bloquea al contacto sin responderle: su lead se cierra como perdido y sus mensajes nuevos se descartan. El motivo queda en la ficha y se puede desbloquear desde el menú ⋯ del lead."
          />
          <Field label="Criterios de bloqueo" hint="Uno por línea. Sé específico: ante la duda, la IA no bloquea.">
            <textarea
              name="autoBlockCriteria"
              rows={4}
              defaultValue={s.autoBlockCriteria}
              placeholder={"Spam o publicidad de otras empresas\nPersonas que buscan trabajo o envían su currículum\nInsultos o amenazas"}
              className={inputClass}
            />
          </Field>
        </PanelBody>
      </Panel>

      <SaveBar note={message && !isSaved(message) && <FormMessage>{message}</FormMessage>}>
        <SubmitButton>Guardar cambios</SubmitButton>
      </SaveBar>
    </form>
  );
}
