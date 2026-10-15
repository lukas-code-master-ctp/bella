"use client";

import { useActionState, useState } from "react";
import { Send } from "lucide-react";
import { Field, FormMessage, inputClass } from "@/components/ui";
import { HourSelect, PanelBody, PanelFooter } from "@/components/settings-ui";
import { ToggleSection } from "@/components/toggle-section";
import { SubmitButton } from "@/components/submit-button";
import { runFollowUpsNowAction, saveFollowUpsAction } from "../actions";
import { isSaved, savedToast, withToast } from "@/components/toast";

const UNIT: Record<string, string> = { m: "min", min: "min", h: "h", d: "d" };
const UNIT_MINUTES: Record<string, number> = { m: 1, min: 1, h: 60, d: 24 * 60 };
/** Ventana de Meta para escribirle al cliente desde su último mensaje (ver REPLY_WINDOW_MS). */
const WINDOW_MINUTES = 24 * 60;

/** Línea de tiempo de los plazos que se van escribiendo ("3h, 1d" → 3 h · 1 d). */
function DelayTimeline({ value, template }: { value: string; template: boolean }) {
  const steps = value
    .split(/[,;\s]+/)
    .map((s) => s.toLowerCase().match(/^(\d+(?:\.\d+)?)(m|min|h|d)$/))
    .filter((m): m is RegExpMatchArray => Boolean(m));
  if (!steps.length) return null;
  // Cada plazo se cuenta desde el mensaje anterior de la IA, así que se van sumando.
  let total = 0;
  const late = new Set<number>();
  steps.forEach(([, n, u], i) => {
    total += Number(n) * UNIT_MINUTES[u];
    if (total > WINDOW_MINUTES) late.add(i);
  });
  return (
    <div className="space-y-2">
      <ol aria-label="Seguimientos" className="flex flex-wrap items-center gap-y-2 text-xs">
        <li className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600">Último mensaje de la IA</li>
        {steps.map(([, n, u], i) => (
          <li key={i} className="flex items-center">
            <span aria-hidden className="h-px w-5 bg-slate-300" />
            <span
              className={`rounded-full px-2.5 py-1 font-medium ring-1 ring-inset ${
                late.has(i)
                  ? template
                    ? "bg-sky-50 text-sky-800 ring-sky-200"
                    : "bg-amber-50 text-amber-800 ring-amber-200 line-through"
                  : "bg-brand-50 text-brand-800 ring-brand-200"
              }`}
            >
              #{i + 1} · {n} {UNIT[u]}
              {late.has(i) && template && " · plantilla"}
            </span>
          </li>
        ))}
      </ol>
      {late.size > 0 &&
        (template ? (
          <p className="text-xs text-sky-800">
            Los marcados con plantilla caen más de 24 horas después del último mensaje del cliente: en WhatsApp se envía la
            plantilla de abajo, y en Instagram y Messenger no se envían. Los plazos se suman uno tras otro.
          </p>
        ) : (
          <p className="text-xs text-amber-800">
            {late.size === 1 ? "El seguimiento tachado cae" : "Los seguimientos tachados caen"} más de 24 horas después del
            último mensaje del cliente: Meta no permite enviarlos sin una plantilla aprobada. Los plazos se suman uno tras otro.
          </p>
        ))}
    </div>
  );
}

export function FollowUpsForm(props: {
  enabled: boolean;
  delays: string;
  sendFrom: number;
  sendTo: number;
  instructions: string;
  template: { name: string; language: string; text: string };
}) {
  const [message, action] = useActionState(withToast(saveFollowUpsAction, savedToast), null);
  const [delays, setDelays] = useState(props.delays);
  const [templateName, setTemplateName] = useState(props.template.name);
  const [templateText, setTemplateText] = useState(props.template.text);
  const template = Boolean(templateName.trim() && templateText.trim());
  return (
    <form action={action}>
      <PanelBody>
        <ToggleSection
          name="enabled"
          defaultChecked={props.enabled}
          title="Hacer seguimiento a los leads que dejan de responder"
          description="La asistente vuelve a escribir en los plazos de abajo, solo dentro del horario de envío."
        >
          <Field label="Plazos" hint="Silencio antes de cada seguimiento, desde el último mensaje de la IA. m = minutos, h = horas, d = días.">
            <input name="delays" required value={delays} onChange={(e) => setDelays(e.target.value)} placeholder="2h, 20h" className={`${inputClass} font-mono`} />
          </Field>
          <DelayTimeline value={delays} template={template} />
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
          <fieldset className="space-y-3 rounded-lg border border-slate-200 p-4">
            <legend className="px-1 text-sm font-semibold text-slate-900">Plantilla de WhatsApp para después de 24 horas</legend>
            <p className="text-xs text-slate-600">
              Opcional. Crea la plantilla en WhatsApp Manager (categoría Marketing) y, cuando Meta la apruebe, copia aquí su
              nombre y su texto. Se envía tal cual, sin pasar por la IA. Si la dejas vacía, esos seguimientos no se envían.
            </p>
            <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
              <Field label="Nombre de la plantilla" hint="Tal como aparece en Meta, ej. seguimiento_1">
                <input name="templateName" value={templateName} onChange={(e) => setTemplateName(e.target.value)} className={`${inputClass} font-mono`} />
              </Field>
              <Field label="Idioma" hint="Código, ej. es">
                <input name="templateLanguage" defaultValue={props.template.language} className={`${inputClass} font-mono`} />
              </Field>
            </div>
            <Field label="Texto de la plantilla" hint="El mismo texto aprobado. Usa {{1}} donde va el nombre del cliente.">
              <textarea
                name="templateText"
                rows={3}
                value={templateText}
                onChange={(e) => setTemplateText(e.target.value)}
                placeholder="Hola {{1}}, ¿sigues interesado? Si quieres retomar, respóndeme por aquí."
                className={inputClass}
              />
            </Field>
          </fieldset>
        </ToggleSection>
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
