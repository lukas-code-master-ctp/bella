"use client";

import { useActionState, useState } from "react";
import { KeyRound, Network, Zap } from "lucide-react";
import type { AiConfig, AiProvider } from "@/lib/ai/config";
import type { ModelOption, OpenRouterKeyInfo } from "@/lib/ai/models";
import { Field, FormMessage, inputClass } from "@/components/ui";
import { Callout, ChoiceCard, PanelBody, PanelFooter, Segmented } from "@/components/settings-ui";
import { SubmitButton } from "@/components/submit-button";
import Link from "next/link";
import { saveAiAction } from "../actions";

const PROVIDERS = [
  ["openrouter", "OpenRouter", "Cientos de modelos con una sola clave. Recomendado.", <Network key="i" />],
  ["anthropic", "Anthropic (directo)", "Los modelos Claude con la clave de Anthropic.", <Zap key="i" />],
] as const;

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
  const price = (m: ModelOption | undefined) =>
    provider === "openrouter" && m ? `${m.name} · USD por millón de tokens (entrada / salida): ${m.price}` : undefined;

  return (
    <form action={action}>
      <PanelBody>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium text-slate-800">Proveedor</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {PROVIDERS.map(([value, title, description, icon]) => (
              <ChoiceCard
                key={value}
                name="provider"
                value={value}
                title={title}
                description={description}
                icon={icon}
                checked={provider === value}
                onChange={() => {
                  setProvider(value);
                  setModel(value === config.provider ? config.model : defaults[value]);
                  setSummaryModel(value === config.provider ? config.summaryModel : summaryDefaults[value]);
                }}
              />
            ))}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Modelo de la conversación" hint={price(selected)}>
            <input
              name="model"
              list={provider === "openrouter" ? "openrouter-models" : undefined}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              required
              className={`${inputClass} font-mono`}
            />
          </Field>
          <Field label="Modelo para resumen y puntaje" hint={price(summarySelected)}>
            <input
              name="summaryModel"
              list={provider === "openrouter" ? "openrouter-models" : undefined}
              value={summaryModel}
              onChange={(e) => setSummaryModel(e.target.value)}
              required
              className={`${inputClass} font-mono`}
            />
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
          <Callout tone="warning">Ese modelo no aparece en OpenRouter. Escribe en el campo para buscar en la lista.</Callout>
        )}
        <Segmented
          name="effort"
          legend="Esfuerzo de razonamiento"
          defaultValue={config.effort}
          options={[
            ["low", "Bajo"],
            ["medium", "Medio"],
            ["high", "Alto"],
          ]}
          hint="Más esfuerzo: respuestas más pensadas, pero más lentas y caras."
        />
        {!keys[provider] && (
          <Callout tone="danger" title="Falta la clave">
            Pega la clave de {provider === "openrouter" ? "OpenRouter" : "Anthropic"} en{" "}
            <Link href="/settings/credentials" className="font-medium underline">
              Credenciales
            </Link>
            .
          </Callout>
        )}
      </PanelBody>
      <PanelFooter
        note={
          message ? (
            <FormMessage tone={message.startsWith("Guardado") ? "neutral" : "danger"}>{message}</FormMessage>
          ) : provider === "openrouter" && keyInfo ? (
            <span className="inline-flex items-center gap-1.5">
              <KeyRound aria-hidden className="size-3.5" />
              Clave en uso: <span className="font-medium text-slate-800">{keyInfo.label}</span>
            </span>
          ) : null
        }
      >
        <SubmitButton>Guardar modelo</SubmitButton>
      </PanelFooter>
    </form>
  );
}
