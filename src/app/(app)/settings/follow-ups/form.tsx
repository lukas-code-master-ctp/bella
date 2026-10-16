"use client";

import { useActionState, useRef, useState } from "react";
import { Send, UserRound } from "lucide-react";
import { Badge, Field, FormMessage, inputClass } from "@/components/ui";
import { HourSelect, PanelBody, PanelFooter } from "@/components/settings-ui";
import { ToggleSection } from "@/components/toggle-section";
import { SubmitButton } from "@/components/submit-button";
import { runFollowUpsNowAction, saveFollowUpsAction, submitTemplateAction } from "../actions";
import type { TemplateStatus } from "@/lib/channels/whatsapp";
import { isSaved, savedToast, withToast } from "@/components/toast";

/** Idiomas de plantilla que acepta Meta (no existe es_CL). */
const TEMPLATE_LANGUAGES = [
  { value: "es", label: "Español" },
  { value: "es_MX", label: "Español (México)" },
  { value: "es_AR", label: "Español (Argentina)" },
  { value: "es_ES", label: "Español (España)" },
  { value: "en", label: "Inglés" },
  { value: "en_US", label: "Inglés (EE. UU.)" },
  { value: "pt_BR", label: "Portugués (Brasil)" },
];

const STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  APPROVED: { label: "Aprobada por Meta", tone: "success" },
  PENDING: { label: "En revisión en Meta", tone: "warning" },
  IN_APPEAL: { label: "En apelación en Meta", tone: "warning" },
  REJECTED: { label: "Rechazada por Meta", tone: "danger" },
  PAUSED: { label: "Pausada por Meta", tone: "danger" },
  DISABLED: { label: "Desactivada por Meta", tone: "danger" },
};

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
  /** null: no existe en Meta; undefined: no se pudo consultar o no hay plantilla. */
  templateStatus?: TemplateStatus | null;
}) {
  const [message, action] = useActionState(withToast(saveFollowUpsAction, savedToast), null);
  const [delays, setDelays] = useState(props.delays);
  const [templateName, setTemplateName] = useState(props.template.name);
  const [templateText, setTemplateText] = useState(props.template.text);
  const [submitMessage, submitAction] = useActionState(submitTemplateAction, null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const template = Boolean(templateName.trim() && templateText.trim());
  // La plantilla del formulario es la guardada: el estado de Meta corresponde a ella.
  const unchanged = templateName.trim().toLowerCase() === props.template.name && templateText.trim() === props.template.text;
  const status = unchanged ? props.templateStatus : undefined;
  const insertName = () => {
    const el = textRef.current;
    const at = el?.selectionStart ?? templateText.length;
    const end = el?.selectionEnd ?? at;
    setTemplateText(templateText.slice(0, at) + "{{1}}" + templateText.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + 5, at + 5);
    });
  };
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
              Opcional. Escríbela aquí y envíala a revisión de Meta (categoría Marketing). Cuando la aprueben se usa tal cual,
              sin pasar por la IA. Si ya la tienes aprobada en WhatsApp Manager, copia su nombre y su texto. Si la dejas vacía,
              esos seguimientos no se envían.
            </p>
            {status !== undefined && (
              <p className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                {status ? (
                  <>
                    <Badge tone={STATUS[status.status]?.tone ?? "neutral"}>{STATUS[status.status]?.label ?? status.status}</Badge>
                    {status.reason && <span>Motivo: {status.reason}</span>}
                  </>
                ) : (
                  <Badge tone="neutral">Aún no existe en Meta</Badge>
                )}
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
              <Field label="Nombre de la plantilla" hint="Tal como aparece en Meta, ej. seguimiento_1">
                <input name="templateName" value={templateName} onChange={(e) => setTemplateName(e.target.value)} className={`${inputClass} font-mono`} />
              </Field>
              <Field label="Idioma" hint="El de la plantilla en Meta">
                <select name="templateLanguage" defaultValue={props.template.language} className={inputClass}>
                  {!TEMPLATE_LANGUAGES.some((l) => l.value === props.template.language) && (
                    <option value={props.template.language}>{props.template.language}</option>
                  )}
                  {TEMPLATE_LANGUAGES.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Texto de la plantilla" hint="El mismo texto aprobado. Usa {{1}} donde va el nombre del cliente.">
              <textarea
                ref={textRef}
                name="templateText"
                rows={3}
                value={templateText}
                onChange={(e) => setTemplateText(e.target.value)}
                placeholder="Hola {{1}}, ¿sigues interesado? Si quieres retomar, respóndeme por aquí."
                className={inputClass}
              />
            </Field>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={insertName}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:border-slate-400 [&_svg]:size-3.5"
              >
                <UserRound aria-hidden />
                Insertar nombre del cliente
              </button>
              <SubmitButton formAction={submitAction} variant="secondary" size="sm" pendingText="Enviando…">
                <Send aria-hidden />
                Enviar a Meta para revisión
              </SubmitButton>
            </div>
            {submitMessage && <FormMessage tone={submitMessage.startsWith("Enviada") ? "neutral" : "danger"}>{submitMessage}</FormMessage>}
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
