"use client";

import { useActionState, useState } from "react";
import { Copy, Plus, Send } from "lucide-react";
import { Button, Field, FormMessage, inputClass } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { createWebhookAction, testWebhookAction } from "./actions";

export function NewWebhookForm({ stages }: { stages: { id: string; name: string }[] }) {
  const [message, action] = useActionState(createWebhookAction, null);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
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
      <div className="sm:col-span-2">
        <Field label="URL" hint="Bella le enviará un POST con los datos del lead en JSON. Debe empezar con https://">
          <input name="url" type="url" required placeholder="https://hooks.zapier.com/hooks/catch/…" className={inputClass} />
        </Field>
      </div>
      {message && (
        <div className="sm:col-span-2">
          <FormMessage>{message}</FormMessage>
        </div>
      )}
      <div className="sm:col-span-2">
        <SubmitButton>
          <Plus aria-hidden />
          Crear webhook
        </SubmitButton>
      </div>
    </form>
  );
}

export function TestWebhookButton({ id }: { id: string }) {
  const [result, action] = useActionState(() => testWebhookAction(id), null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <SubmitButton variant="secondary" pendingText="Enviando…">
        <Send aria-hidden />
        Probar
      </SubmitButton>
      {result && (
        <span role="status" className={`text-xs ${result.ok ? "text-emerald-700" : "text-rose-700"}`}>
          {result.message}
        </span>
      )}
    </form>
  );
}

export function CopySecret({ secret }: { secret: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="flex min-w-0 items-center gap-2">
      <code className="min-w-0 truncate rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">{secret}</code>
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
        <Copy aria-hidden />
        {copied ? "Copiada" : "Copiar"}
      </Button>
    </span>
  );
}
