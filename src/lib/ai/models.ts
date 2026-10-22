import { credential } from "../credentials";
import { OPENROUTER_URL } from "./providers";

export type ModelOption = { id: string; name: string; price: string };

/** Precio por millón de tokens (entrada / salida) en dólares, para mostrar en el selector. */
function formatPrice(pricing?: { prompt?: string; completion?: string }) {
  const perMillion = (v?: string) => (v ? `$${+(Number(v) * 1e6).toFixed(2)}` : "?");
  return `${perMillion(pricing?.prompt)} / ${perMillion(pricing?.completion)}`;
}

/**
 * Modelos de OpenRouter que aceptan herramientas (la asistente las necesita para mover etapas,
 * etiquetar y buscar). La lista es pública; se cachea una hora. Devuelve null si no responde.
 */
export async function listOpenRouterModels(): Promise<ModelOption[] | null> {
  try {
    const res = await fetch(`${OPENROUTER_URL}/models`, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    const { data } = (await res.json()) as {
      data: { id: string; name: string; supported_parameters?: string[]; pricing?: { prompt?: string; completion?: string } }[];
    };
    return data
      .filter((m) => m.supported_parameters?.includes("tools"))
      .map((m) => ({ id: m.id, name: m.name, price: formatPrice(m.pricing) }))
      .sort((a, b) => a.id.localeCompare(b.id));
  } catch {
    return null;
  }
}

export type OpenRouterKeyInfo = { label: string; usage: number };

/**
 * Datos de la clave OPENROUTER_API_KEY que usa el servidor (nombre y gasto acumulado), para
 * saber en qué cuenta de OpenRouter quedan los registros. Null si no hay clave o no responde.
 */
export async function getOpenRouterKeyInfo(): Promise<OpenRouterKeyInfo | null> {
  const key = await credential("OPENROUTER_API_KEY");
  if (!key) return null;
  try {
    const res = await fetch(`${OPENROUTER_URL}/key`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const { data } = (await res.json()) as { data?: { label?: string; usage?: number } };
    return data ? { label: data.label ?? "(sin nombre)", usage: data.usage ?? 0 } : null;
  } catch {
    return null;
  }
}

export type SpeechModelOption = {
  id: string;
  name: string;
  voices: string[];
  /** Dólares por unidad de entrada (carácter o token, según el modelo) y de salida (token de audio o segundo). */
  pricing: { prompt: number; completion: number };
  /** Los modelos de Gemini cobran por token (texto y audio); los demás, por carácter o por segundo. */
  tokenizer: string | null;
};

/** Modelos de voz (texto a audio) de OpenRouter, con sus voces. Se cachea una hora; null si no responde. */
export async function listSpeechModels(): Promise<SpeechModelOption[] | null> {
  try {
    const res = await fetch(`${OPENROUTER_URL}/models?output_modalities=speech`, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    const { data } = (await res.json()) as {
      data: {
        id: string;
        name: string;
        supported_voices?: string[] | null;
        pricing?: { prompt?: string; completion?: string };
        architecture?: { tokenizer?: string | null };
      }[];
    };
    return data
      .map((m) => ({
        id: m.id,
        name: m.name,
        voices: m.supported_voices ?? [],
        pricing: { prompt: Number(m.pricing?.prompt) || 0, completion: Number(m.pricing?.completion) || 0 },
        tokenizer: m.architecture?.tokenizer ?? null,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  } catch {
    return null;
  }
}
