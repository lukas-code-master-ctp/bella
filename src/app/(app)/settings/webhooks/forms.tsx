"use client";

import { useActionState, useState } from "react";
import { Check, Copy, Eye, EyeOff, Plus, Send } from "lucide-react";
import { Button, Field, FormMessage, inputClass } from "@/components/ui";
import { PanelBody, PanelFooter } from "@/components/settings-ui";
import { SubmitButton } from "@/components/submit-button";
import { createWebhookAction, testWebhookAction } from "./actions";
import { withToast } from "@/components/toast";

export function NewWebhookForm({ stages }: { stages: { id: string; name: string }[] }) {
  const [message, action] = useActionState(withToast(createWebhookAction, (e) => (e ? null : "Webhook creado")), null);
  return (
    <form action={action}>
      <PanelBody>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre">
            <input name="name" required placeholder="Ej. Agendar visita en el calendario" className={inputClass} />
          </Field>
          <Field label="Cuando el lead entra a la etapa">
            <select name="stageId" required className={inputClass}>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="URL" hint="Beliapp le enviará un POST con los datos del lead en JSON. Debe empezar con https://">
          <input name="url" type="url" required placeholder="https://hooks.zapier.com/hooks/catch/…" className={`${inputClass} font-mono`} />
        </Field>
      </PanelBody>
      <PanelFooter note={message && <FormMessage>{message}</FormMessage>}>
        <SubmitButton>
          <Plus aria-hidden />
          Crear webhook
        </SubmitButton>
      </PanelFooter>
    </form>
  );
}

export function TestWebhookButton({ id }: { id: string }) {
  const [result, action] = useActionState(() => testWebhookAction(id), null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      {result && (
        <span role="status" className={`animate-fade-in text-xs font-medium ${result.ok ? "text-emerald-700" : "text-rose-700"}`}>
          {result.message}
        </span>
      )}
      <SubmitButton variant="secondary" size="sm" pendingText="Enviando…">
        <Send aria-hidden />
        Probar
      </SubmitButton>
    </form>
  );
}

/** Clave de firma oculta por defecto, con botones para verla y copiarla. */
export function CopySecret({ secret }: { secret: string }) {
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(false);
  return (
    <span className="flex min-w-0 items-center gap-1">
      <code className="min-w-0 truncate rounded-md bg-slate-100 px-2 py-1 font-mono text-xs text-slate-700">
        {shown ? secret : "•".repeat(Math.min(secret.length, 24))}
      </code>
      <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={shown ? "Ocultar clave" : "Ver clave"} onClick={() => setShown(!shown)}>
        {shown ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          void navigator.clipboard.writeText(secret).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check aria-hidden className="animate-pop text-emerald-600" /> : <Copy aria-hidden />}
        {copied ? "Copiada" : "Copiar"}
      </Button>
    </span>
  );
}
