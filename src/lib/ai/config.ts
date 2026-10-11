import { credential, credentials } from "../credentials";
import { getSetting } from "../settings";

export type AiProvider = "openrouter" | "anthropic";
export type AiEffort = "low" | "medium" | "high";

export type AiConfig = {
  provider: AiProvider;
  model: string;
  effort: AiEffort;
  /** Modelo chico y barato para el resumen y el puntaje del lead (ver insights.ts). */
  summaryModel?: string;
};

export const PROVIDER_LABEL: Record<AiProvider, string> = {
  openrouter: "OpenRouter",
  anthropic: "Anthropic",
};

export const API_KEY_ENV = {
  openrouter: "OPENROUTER_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
} as const satisfies Record<AiProvider, string>;

export const DEFAULT_MODEL: Record<AiProvider, string> = {
  openrouter: "anthropic/claude-opus-5.5",
  anthropic: "claude-opus-5-5",
};

export const DEFAULT_SUMMARY_MODEL: Record<AiProvider, string> = {
  openrouter: "anthropic/claude-haiku-5.5",
  anthropic: "claude-haiku-5-5",
};

/** Proveedor por defecto: OpenRouter si su clave está configurada, si no Anthropic. */
async function defaultProvider(): Promise<AiProvider> {
  const c = await credentials();
  return c.OPENROUTER_API_KEY || !c.ANTHROPIC_API_KEY ? "openrouter" : "anthropic";
}

export async function getAiConfig(): Promise<Required<AiConfig>> {
  const saved = await getSetting<Partial<AiConfig>>("ai", {});
  const provider = saved.provider ?? (await defaultProvider());
  return {
    provider,
    // El modelo guardado solo vale para el proveedor con que se guardó.
    model: (saved.provider === provider && saved.model) || DEFAULT_MODEL[provider],
    effort: saved.effort ?? "medium",
    summaryModel: (saved.provider === provider && saved.summaryModel) || DEFAULT_SUMMARY_MODEL[provider],
  };
}

/** Mensaje para el usuario si falta la clave del proveedor elegido; null si está todo listo. */
export async function missingKeyMessage(provider: AiProvider): Promise<string | null> {
  return (await credential(API_KEY_ENV[provider]))
    ? null
    : `Falta la clave de ${PROVIDER_LABEL[provider]} en Configuración → Credenciales: la IA no puede responder.`;
}
