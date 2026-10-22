import { credential } from "../credentials";
import { recordAiUsage } from "../domain/ai-usage";
import type { VoiceNoteSettings } from "../domain/voice-notes";
import { blobStore, type MediaStore } from "../media";
import { decodeMp3, encodeOggOpus } from "../voice-note";
import { listSpeechModels } from "./models";
import { APP_URL, OPENROUTER_URL } from "./providers";

/**
 * Voz de la IA: el texto se convierte en audio con un modelo de voz de OpenRouter (la misma clave
 * de Credenciales) y se arma una nota de voz Ogg/Opus, el formato que WhatsApp muestra como nota
 * de voz nativa. El gasto se suma al consumo de IA de la empresa.
 */

export type SpeechRequest = Pick<VoiceNoteSettings, "model" | "voice" | "instructions"> & { text: string };

/** Devuelve el MP3 y el id de la generación en OpenRouter (para saber cuánto costó). */
export type SpeechClient = (req: SpeechRequest) => Promise<{ mp3: Uint8Array; generationId: string | null }>;

export type VoiceDeps = { speak?: SpeechClient; store?: MediaStore; cost?: (usage: SpeechUsage) => Promise<void> };

export const openRouterSpeech: SpeechClient = async ({ model, voice, instructions, text }) => {
  const key = await credential("OPENROUTER_API_KEY");
  if (!key) throw new Error("Falta la clave de OpenRouter en Configuración → Credenciales para generar audios.");
  const res = await fetch(`${OPENROUTER_URL}/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": APP_URL,
      "X-Title": "Beliapp",
    },
    body: JSON.stringify({
      model,
      input: text,
      response_format: "mp3",
      ...(voice.trim() ? { voice: voice.trim() } : {}),
      ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
    }),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(`OpenRouter ${res.status} al generar el audio: ${json.error?.message ?? res.statusText}`);
  }
  return { mp3: new Uint8Array(await res.arrayBuffer()), generationId: res.headers.get("x-generation-id") };
};

export type VoiceNoteAudio = { bytes: Uint8Array; seconds: number; usage: SpeechUsage };
export type SpeechUsage = { model: string; generationId: string | null; chars: number; seconds: number };

/** Texto → nota de voz Ogg/Opus. */
export async function synthesizeVoiceNote(req: SpeechRequest, speak: SpeechClient = openRouterSpeech): Promise<VoiceNoteAudio> {
  const { mp3, generationId } = await speak(req);
  const { samples, sampleRate } = await decodeMp3(mp3);
  const seconds = samples.length / sampleRate;
  return {
    bytes: encodeOggOpus(samples, sampleRate),
    seconds,
    usage: { model: req.model, generationId, chars: req.text.length, seconds },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** OpenRouter tarda unos segundos en tener lista la generación con su costo. */
const GENERATION_WAITS_MS = [1000, 2000, 4000, 8000];

async function generationCost(generationId: string): Promise<number | null> {
  const key = await credential("OPENROUTER_API_KEY");
  for (const wait of GENERATION_WAITS_MS) {
    await sleep(wait);
    try {
      const res = await fetch(`${OPENROUTER_URL}/generation?id=${encodeURIComponent(generationId)}`, {
        headers: { Authorization: `Bearer ${key}` },
        cache: "no-store",
      });
      if (res.status === 404) continue;
      if (!res.ok) return null;
      const { data } = (await res.json()) as { data?: { total_cost?: number } };
      if (typeof data?.total_cost === "number") return data.total_cost;
    } catch {
      // se reintenta
    }
  }
  return null;
}

/** Gemini cuenta ~25 tokens de audio por segundo y ~4 caracteres por token de texto. */
const GEMINI_AUDIO_TOKENS_PER_SECOND = 25;

/** Si OpenRouter no informa el costo, se estima con los precios del modelo. */
async function estimatedCost({ model, chars, seconds }: SpeechUsage): Promise<number> {
  const info = (await listSpeechModels())?.find((m) => m.id === model);
  if (!info) return 0;
  const { prompt, completion } = info.pricing;
  return info.tokenizer === "Gemini"
    ? prompt * (chars / 4) + completion * seconds * GEMINI_AUDIO_TOKENS_PER_SECOND
    : prompt * chars + completion * seconds;
}

/** Suma el audio al consumo de IA. Nunca falla. */
export async function recordSpeechCost(usage: SpeechUsage) {
  try {
    const reported = usage.generationId ? await generationCost(usage.generationId) : null;
    const cost = reported ?? (await estimatedCost(usage));
    await recordAiUsage({ model: usage.model, inputTokens: usage.chars, outputTokens: 0, cost });
  } catch (err) {
    console.error("[voz] no se pudo registrar el consumo:", err);
  }
}

/**
 * Genera la nota de voz de una respuesta de la IA y la guarda. Si algo falla devuelve null y la
 * respuesta sale como texto. `settle` registra el gasto: se llama después de enviar, para no
 * demorar la respuesta mientras OpenRouter calcula el costo.
 */
export async function voiceNoteFor(
  leadId: string,
  text: string,
  s: VoiceNoteSettings,
  deps: VoiceDeps = {},
): Promise<{ mediaUrl: string; mediaType: string; settle: () => Promise<void> } | null> {
  try {
    const audio = await synthesizeVoiceNote({ model: s.model, voice: s.voice, instructions: s.instructions, text }, deps.speak);
    const mediaUrl = await (deps.store ?? blobStore)(
      { bytes: audio.bytes, mimeType: "audio/ogg", fileName: "nota-de-voz-ia.ogg" },
      `leads/${leadId}`,
    );
    return { mediaUrl, mediaType: "audio/ogg", settle: () => (deps.cost ?? recordSpeechCost)(audio.usage) };
  } catch (err) {
    console.error(`[voz] lead ${leadId}: la respuesta va en texto:`, err);
    return null;
  }
}
