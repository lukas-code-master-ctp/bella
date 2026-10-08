"use client";

import { useActionState, useState } from "react";
import type { AiConfig, AiProvider } from "@/lib/ai/config";
import type { ModelOption } from "@/lib/ai/models";
import { Field, inputClass } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { saveAiAction } from "../actions";

export function AiForm({
  config,
  models,
  defaults,
  keys,
}: {
  config: AiConfig;
  models: ModelOption[] | null;
  defaults: Record<AiProvider, string>;
  keys: Record<AiProvider, boolean>;
}) {
  const [message, action] = useActionState(saveAiAction, null);
  const [provider, setProvider] = useState(config.provider);
  const [model, setModel] = useState(config.model);
  const selected = models?.find((m) => m.id === model);

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Proveedor">
          <select
            name="provider"
            value={provider}
            onChange={(e) => {
              const next = e.target.value as AiProvider;
              setProvider(next);
              setModel(next === config.provider ? config.model : defaults[next]);
            }}
            className={inputClass}
          >
            <option value="openrouter">OpenRouter</option>
            <option value="anthropic">Anthropic (directo)</option>
          </select>
        </Field>
        <Field label="Modelo" hint={provider === "openrouter" && selected ? `${selected.name} · USD por millón de tokens (entrada / salida): ${selected.price}` : undefined}>
          <input
            name="model"
            list={provider === "openrouter" ? "openrouter-models" : undefined}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            required
            className={inputClass}
          />
        </Field>
        <Field label="Esfuerzo de razonamiento" hint="Más esfuerzo: respuestas más pensadas, pero más lentas y caras.">
          <select name="effort" defaultValue={config.effort} className={inputClass}>
            <option value="low">Bajo</option>
            <option value="medium">Medio</option>
            <option value="high">Alto</option>
          </select>
        </Field>
      </div>
      {provider === "openrouter" && models && (
        <datalist id="openrouter-models">
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </datalist>
      )}
      {provider === "openrouter" && models && !selected && (
        <p className="text-sm text-amber-700">Ese modelo no aparece en OpenRouter. Escribe para buscar en la lista.</p>
      )}
      {!keys[provider] && (
        <p className="text-sm text-rose-600">
          Falta la variable {provider === "openrouter" ? "OPENROUTER_API_KEY" : "ANTHROPIC_API_KEY"} en el servidor.
          Agrégala en Vercel y vuelve a desplegar.
        </p>
      )}
      <div className="flex items-center gap-3">
        <SubmitButton>Guardar modelo</SubmitButton>
        {message && <span className="text-sm text-slate-600">{message}</span>}
      </div>
    </form>
  );
}
