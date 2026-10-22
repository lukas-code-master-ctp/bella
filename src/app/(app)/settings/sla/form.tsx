"use client";

import { useActionState } from "react";
import { BellRing, CalendarClock, Timer } from "lucide-react";
import type { SlaSettings } from "@/lib/domain/sla";
import { Field, FormMessage, inputClass } from "@/components/ui";
import { Callout, Chip, FieldGroup, HourSelect, Panel, PanelBody, SaveBar, ToggleRow } from "@/components/settings-ui";
import { ToggleSection } from "@/components/toggle-section";
import { SubmitButton } from "@/components/submit-button";
import { isSaved, savedToast, withToast } from "@/components/toast";
import { saveSlaAction } from "./actions";

// Lunes primero; el valor es el día de la semana (0 = domingo).
const DAYS: [number, string][] = [[1, "Lun"], [2, "Mar"], [3, "Mié"], [4, "Jue"], [5, "Vie"], [6, "Sáb"], [0, "Dom"]];

export function SlaForm({ settings: s, hoursStatus }: { settings: SlaSettings; hoursStatus: string }) {
  const [message, action] = useActionState(withToast(saveSlaAction, savedToast), null);
  return (
    <form action={action} className="space-y-6">
      <Panel icon={<Timer />} title="Metas de respuesta" description="Cuánto puede esperar un cliente cuando lo atiende una persona del equipo. Al pasarla, el lead se marca como Atrasado en Chats y en el Funnel.">
        <PanelBody>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Primera respuesta (minutos)" hint="Desde que la IA o una regla deriva el lead a un ejecutivo.">
              <input name="firstMinutes" type="number" min={1} max={10080} required defaultValue={s.firstMinutes} className={inputClass} />
            </Field>
            <Field label="Siguientes respuestas (minutos)" hint="Cada vez que el cliente escribe en un lead que atiende el equipo.">
              <input name="replyMinutes" type="number" min={1} max={10080} required defaultValue={s.replyMinutes} className={inputClass} />
            </Field>
          </div>
        </PanelBody>
      </Panel>

      <Panel icon={<BellRing />} title="Avisos de atraso" description="Se revisa cada 5 minutos. Llegan como push en Avisos y, si cada persona lo elige, por correo.">
        <PanelBody>
          <ToggleRow
            name="alerts"
            defaultChecked={s.alerts}
            title="Avisar al ejecutivo cuando un lead pasa la meta"
            description="Si el lead no tiene ejecutivo, el aviso va a los administradores."
          />
          <ToggleRow
            name="escalate"
            defaultChecked={s.escalate}
            title="Avisar a los administradores al doble de la meta"
            description="Por ejemplo, con una meta de 15 minutos, los admins se enteran a los 30 si nadie ha respondido."
          />
        </PanelBody>
      </Panel>

      <Panel icon={<CalendarClock />} title="Horario laboral" description={hoursStatus}>
        <PanelBody>
          <ToggleSection
            name="hoursEnabled"
            defaultChecked={s.hoursEnabled}
            title="Contar solo el tiempo dentro del horario laboral"
            description="Un mensaje que llega de noche o el fin de semana empieza a contar cuando abre el horario."
          >
            <FieldGroup title="Días laborales">
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
          </ToggleSection>
          <Callout tone="neutral" className="mt-4">
            Es independiente del horario de atención de la IA (Funcionamiento IA): la asistente puede responder a toda hora y el
            equipo, solo en horario de oficina.
          </Callout>
        </PanelBody>
      </Panel>

      <SaveBar note={message && !isSaved(message) && <FormMessage>{message}</FormMessage>}>
        <SubmitButton>Guardar cambios</SubmitButton>
      </SaveBar>
    </form>
  );
}
