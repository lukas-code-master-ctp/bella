import { getSetting } from "../settings";

export type AiProvider = "openrouter" | "anthropic";
export type AiEffort = "low" | "medium" | "high";

export type AiConfig = {
  provider: AiProvider;
  model: string;
  effort: AiEffort;
};

export const PROVIDER_LABEL: Record<AiProvider, string> = {
  openrouter: "OpenRouter",
  anthropic: "Anthropic",
};

export const API_KEY_ENV: Record<AiProvider, string> = {
  openrouter: "OPENROUTER_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

export const DEFAULT_MODEL: Record<AiProvider, string> = {
  openrouter: "anthropic/claude-opus-5.5",
  anthropic: "claude-opus-5-5",
};

/** Proveedor por defecto: OpenRouter si su clave está configurada, si no Anthropic. */
function defaultProvider(): AiProvider {
  return process.env.OPENROUTER_API_KEY || !process.env.ANTHROPIC_API_KEY ? "openrouter" : "anthropic";
}

export async function getAiConfig(): Promise<AiConfig> {
  const saved = await getSetting<Partial<AiConfig>>("ai", {});
  const provider = saved.provider ?? defaultProvider();
  return {
    provider,
    // El modelo guardado solo vale para el proveedor con que se guardó.
    model: (saved.provider === provider && saved.model) || DEFAULT_MODEL[provider],
    effort: saved.effort ?? "medium",
  };
}

/** Mensaje para el usuario si falta la clave del proveedor elegido; null si está todo listo. */
export function missingKeyMessage(provider: AiProvider): string | null {
  const env = API_KEY_ENV[provider];
  return process.env[env] ? null : `Falta configurar ${env} en el servidor: la IA no puede responder.`;
}
