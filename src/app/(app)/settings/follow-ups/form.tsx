"use client";

import { useActionState, useState } from "react";
import { Send } from "lucide-react";
import { Field, FormMessage, inputClass } from "@/components/ui";
import { HourSelect, PanelBody, PanelFooter, ToggleRow } from "@/components/settings-ui";
import { SubmitButton } from "@/components/submit-button";
import { runFollowUpsNowAction, saveFollowUpsAction } from "../actions";
import { isSaved, savedToast, withToast } from "@/components/toast";

const UNIT: Record<string, string> = { m: "min", min: "min", h: "h", d: "d" };

/** Línea de tiempo de los plazos que se van escribiendo ("3h, 1d" → 3 h · 1 d). */
function DelayTimeline({ value }: { value: string }) {
  const steps = value
    .split(/[,;\s]+/)
    .map((s) => s.toLowerCase().match(/^(\d+(?:\.\d+)?)(m|min|h|d)$/))
    .filter((m): m is RegExpMatchArray => Boolean(m));
  if (!steps.length) return null;
  return (
    <ol aria-label="Seguimientos" className="flex flex-wrap items-center gap-y-2 text-xs">
      <li className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600">Último mensaje de la IA</li>
      {steps.map(([, n, u], i) => (
        <li key={i} className="flex items-center">
          <span aria-hidden className="h-px w-5 bg-slate-300" />
          <span className="rounded-full bg-brand-50 px-2.5 py-1 font-medium text-brand-800 ring-1 ring-inset ring-brand-200">
            #{i + 1} · {n} {UNIT[u]}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function FollowUpsForm(props: {
  enabled: boolean;
  delays: string;
  sendFrom: number;
  sendTo: number;
  instructions: string;
}) {
  const [message, action] = useActionState(withToast(saveFollowUpsAction, savedToast), null);
  const [delays, setDelays] = useState(props.delays);
  return (
    <form action={action}>
      <PanelBody>
        <ToggleRow
          name="enabled"
          defaultChecked={props.enabled}
          title="Hacer seguimiento a los leads que dejan de responder"
          description="La asistente vuelve a escribir en los plazos de abajo, solo dentro del horario de envío."
        />
        <Field label="Plazos" hint="Silencio antes de cada seguimiento, desde el último mensaje de la IA. m = minutos, h = horas, d = días.">
          <input name="delays" required value={delays} onChange={(e) => setDelays(e.target.value)} placeholder="3h, 1d, 3d, 7d" className={`${inputClass} font-mono`} />
        </Field>
        <DelayTimeline value={delays} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Enviar desde" hint="Hora de Chile">
            <HourSelect name="sendFrom" max={23} defaultValue={props.sendFrom} className={inputClass} />
          </Field>
          <Field label="Hasta" hint="Fuera de horario esperan hasta el día siguiente">
            <HourSelect name="sendTo" min={1} max={24} defaultValue={props.sendTo} className={inputClass} />
          </Field>
        </div>
        <Field label="Cómo escribir los seguimientos" hint="Se suman a las instrucciones de la asistente.">
          <textarea name="instructions" rows={4} defaultValue={props.instructions} className={inputClass} />
        </Field>
      </PanelBody>
      <PanelFooter note={message && !isSaved(message) && <FormMessage>{message}</FormMessage>}>
        <SubmitButton>Guardar</SubmitButton>
      </PanelFooter>
    </form>
  );
}

export function RunNowForm() {
  const [message, action] = useActionState(runFollowUpsNowAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center justify-end gap-3">
      {message && <FormMessage tone="neutral">{message}</FormMessage>}
      <SubmitButton variant="secondary" size="sm" pendingText="Enviando…">
        <Send aria-hidden />
        Enviar los vencidos ahora
      </SubmitButton>
    </form>
  );
}
