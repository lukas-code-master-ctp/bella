"use client";

import { useActionState, useState } from "react";
import type { AiConfig, AiProvider } from "@/lib/ai/config";
import type { ModelOption, OpenRouterKeyInfo } from "@/lib/ai/models";
import { Field, inputClass } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { saveAiAction } from "../actions";

export function AiForm({
  config,
  models,
  defaults,
  summaryDefaults,
  keys,
  keyInfo,
}: {
  config: Required<AiConfig>;
  models: ModelOption[] | null;
  defaults: Record<AiProvider, string>;
  summaryDefaults: Record<AiProvider, string>;
  keys: Record<AiProvider, boolean>;
  keyInfo: OpenRouterKeyInfo | null;
}) {
  const [message, action] = useActionState(saveAiAction, null);
  const [provider, setProvider] = useState(config.provider);
  const [model, setModel] = useState(config.model);
  const [summaryModel, setSummaryModel] = useState(config.summaryModel);
  const selected = models?.find((m) => m.id === model);
  const summarySelected = models?.find((m) => m.id === summaryModel);

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
              setSummaryModel(next === config.provider ? config.summaryModel : summaryDefaults[next]);
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
      <Field
        label="Modelo para resumen y puntaje"
        hint={
          "Resume cada conversación en una línea y le pone puntaje al lead después de cada respuesta. Conviene uno chico y barato." +
          (provider === "openrouter" && summarySelected ? ` ${summarySelected.name}: ${summarySelected.price} USD por millón de tokens.` : "")
        }
      >
        <input
          name="summaryModel"
          list={provider === "openrouter" ? "openrouter-models" : undefined}
          value={summaryModel}
          onChange={(e) => setSummaryModel(e.target.value)}
          required
          className={`${inputClass} sm:max-w-md`}
        />
      </Field>
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
      {provider === "openrouter" && keyInfo && (
        <p className="text-sm text-slate-600">
          Clave en uso: <span className="font-medium">{keyInfo.label}</span> · gasto acumulado US$
          {keyInfo.usage.toFixed(2)}. Los registros quedan en la cuenta de OpenRouter dueña de esta clave.
        </p>
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
