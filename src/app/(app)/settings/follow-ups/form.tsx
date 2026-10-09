"use client";

import { useActionState } from "react";
import { Field, FormMessage, inputClass } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { runFollowUpsNowAction, saveFollowUpsAction } from "../actions";

export function FollowUpsForm(props: {
  enabled: boolean;
  delays: string;
  sendFrom: number;
  sendTo: number;
  instructions: string;
}) {
  const [message, action] = useActionState(saveFollowUpsAction, null);
  return (
    <form action={action} className="space-y-4">
      <label className="flex min-h-10 items-center gap-2 text-sm font-medium text-slate-800">
        <input type="checkbox" name="enabled" defaultChecked={props.enabled} className="size-4 rounded border-slate-300 accent-brand-600" />
        Hacer seguimiento a los leads que dejan de responder
      </label>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Plazos" hint="Silencio antes de cada seguimiento, desde el último mensaje de la IA. m = minutos, h = horas, d = días.">
          <input name="delays" required defaultValue={props.delays} placeholder="3h, 1d, 3d, 7d" className={inputClass} />
        </Field>
        <Field label="Enviar desde (hora)" hint="Hora de Chile">
          <input name="sendFrom" type="number" min={0} max={23} required defaultValue={props.sendFrom} className={inputClass} />
        </Field>
        <Field label="Hasta (hora)" hint="Fuera de horario esperan hasta el día siguiente">
          <input name="sendTo" type="number" min={1} max={24} required defaultValue={props.sendTo} className={inputClass} />
        </Field>
      </div>
      <Field label="Cómo escribir los seguimientos" hint="Se suman a las instrucciones de la asistente.">
        <textarea name="instructions" rows={4} defaultValue={props.instructions} className={inputClass} />
      </Field>
      <div className="flex items-center gap-3">
        <SubmitButton>Guardar</SubmitButton>
        {message && <FormMessage tone={message === "Guardado." ? "neutral" : "danger"}>{message}</FormMessage>}
      </div>
    </form>
  );
}

export function RunNowForm() {
  const [message, action] = useActionState(runFollowUpsNowAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <SubmitButton variant="secondary" pendingText="Enviando…">
        Enviar los vencidos ahora
      </SubmitButton>
      {message && <FormMessage tone="neutral">{message}</FormMessage>}
    </form>
  );
}
