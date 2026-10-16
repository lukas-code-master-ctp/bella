"use client";

import { useState, useTransition } from "react";
import { LoaderCircle, Send, X } from "lucide-react";
import { templateDraftError, templateDraftParams, type TemplateDraft } from "@/lib/domain/broadcast-templates";
import { Button, Field, FormMessage, inputClass } from "@/components/ui";
import { submitBroadcastTemplateAction } from "../actions";

/** Nombre válido para Meta a partir de lo que escribió: "Preventa Octubre" → "preventa_octubre". */
const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

/** Crear una plantilla nueva sin salir del envío: queda en revisión de Meta. */
export function TemplateForm({ onClose }: { onClose: () => void }) {
  const [label, setLabel] = useState("");
  const [language, setLanguage] = useState("es");
  const [category, setCategory] = useState<TemplateDraft["category"]>("MARKETING");
  const [text, setText] = useState("Hola {{1}}, ");
  const [examples, setExamples] = useState<string[]>(["María"]);
  const [message, setMessage] = useState<{ tone: "danger" | "neutral"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const params = templateDraftParams(text);
  const draft: TemplateDraft = { name: slug(label), language, category, text, examples };

  function submit() {
    const invalid = templateDraftError(draft);
    if (invalid) return setMessage({ tone: "danger", text: invalid });
    setMessage(null);
    start(async () => {
      const res = await submitBroadcastTemplateAction(draft);
      setMessage("error" in res ? { tone: "danger", text: res.error } : { tone: "neutral", text: res.ok });
    });
  }

  const insertVariable = () => setText((t) => `${t}{{${params + 1}}}`);

  return (
    <section aria-label="Nueva plantilla" className="space-y-4 rounded-xl border border-brand-200 bg-brand-50/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Nueva plantilla</h3>
          <p className="text-xs text-slate-600">Meta la revisa antes de poder usarla; suele tardar minutos u horas.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-md p-1 text-slate-500 hover:bg-white hover:text-slate-800">
          <X aria-hidden className="size-4" />
        </button>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Nombre" hint={draft.name ? `Se guarda como ${draft.name}` : "Ej. Preventa octubre"}>
          <input value={label} onChange={(e) => setLabel(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Tipo" hint="Promociones van como marketing.">
          <select value={category} onChange={(e) => setCategory(e.target.value as TemplateDraft["category"])} className={inputClass}>
            <option value="MARKETING">Marketing (promociones, novedades)</option>
            <option value="UTILITY">Aviso (recordatorio, confirmación)</option>
          </select>
        </Field>
        <Field label="Idioma">
          <select value={language} onChange={(e) => setLanguage(e.target.value)} className={inputClass}>
            <option value="es">Español</option>
            <option value="es_CL">Español (Chile)</option>
            <option value="es_MX">Español (México)</option>
            <option value="es_AR">Español (Argentina)</option>
            <option value="en">Inglés</option>
            <option value="pt_BR">Portugués (Brasil)</option>
          </select>
        </Field>
      </div>
      <Field label="Mensaje" hint="{{1}}, {{2}}… se reemplazan por los datos de cada persona. No puede empezar ni terminar con una variable.">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} maxLength={1024} className={inputClass} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={insertVariable}>
          Agregar variable {`{{${params + 1}}}`}
        </Button>
        <span className="text-xs text-slate-600">{text.length}/1024</span>
      </div>
      {params > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: params }, (_, i) => (
            <Field key={i} label={`Ejemplo de {{${i + 1}}}`}>
              <input
                value={examples[i] ?? ""}
                onChange={(e) => setExamples((xs) => Object.assign([...xs], { [i]: e.target.value }))}
                placeholder={i === 0 ? "María" : "Ej. 31 de octubre"}
                className={inputClass}
              />
            </Field>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {message && <FormMessage tone={message.tone}>{message.text}</FormMessage>}
        <Button disabled={pending || !label.trim()} onClick={submit}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin" /> : <Send aria-hidden />}
          {pending ? "Enviando a Meta…" : "Enviar a revisión"}
        </Button>
      </div>
    </section>
  );
}
