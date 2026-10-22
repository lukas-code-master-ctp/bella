"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { currentCompanyId, withCompany } from "@/lib/tenant";
import { listSpeechModels } from "@/lib/ai/models";
import { recordSpeechCost, synthesizeVoiceNote } from "@/lib/ai/speech";
import {
  DEFAULT_VOICE_NOTES,
  saveVoiceNoteSettings,
  VOICE_MAX_CHARS_LIMIT,
  type VoiceNoteSettings,
} from "@/lib/domain/voice-notes";

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

function parse(form: FormData): VoiceNoteSettings {
  const maxChars = Math.round(Number(str(form, "maxChars")));
  return {
    enabled: form.get("enabled") === "on",
    mode: str(form, "mode") === "always" ? "always" : "audio",
    model: str(form, "model") || DEFAULT_VOICE_NOTES.model,
    voice: str(form, "voice"),
    instructions: str(form, "instructions"),
    maxChars: Number.isFinite(maxChars) && maxChars > 0 ? Math.min(maxChars, VOICE_MAX_CHARS_LIMIT) : DEFAULT_VOICE_NOTES.maxChars,
  };
}

async function modelError(s: VoiceNoteSettings): Promise<string | null> {
  const models = await listSpeechModels();
  const model = models?.find((m) => m.id === s.model);
  if (models && !model) return `"${s.model}" no está entre los modelos de voz de OpenRouter.`;
  if (model?.voices.length && s.voice && !model.voices.includes(s.voice)) {
    return `"${s.voice}" no es una voz de ${model.name}. Elige una de la lista.`;
  }
  return null;
}

export async function saveVoiceNotesAction(_prev: string | null, form: FormData): Promise<string | null> {
  await requireAdmin();
  const s = parse(form);
  const error = await modelError(s);
  if (error) return error;
  await saveVoiceNoteSettings(s);
  revalidatePath("/settings/assistant");
  return "Guardado.";
}

export type VoicePreview = { audio: string; seconds: number } | { error: string };

/** "Probar voz": genera una nota de voz con lo que está en el formulario, sin guardarlo. */
export async function previewVoiceAction(form: FormData): Promise<VoicePreview> {
  await requireAdmin();
  const s = parse(form);
  const text = str(form, "sample").slice(0, VOICE_MAX_CHARS_LIMIT);
  if (!text) return { error: "Escribe un texto para probar la voz." };
  const error = await modelError(s);
  if (error) return { error };
  try {
    const audio = await synthesizeVoiceNote({ model: s.model, voice: s.voice, instructions: s.instructions, text });
    // El costo se registra después de responder: OpenRouter tarda unos segundos en tenerlo.
    const companyId = await currentCompanyId();
    after(() => withCompany(companyId, () => recordSpeechCost(audio.usage)));
    return { audio: `data:audio/ogg;base64,${Buffer.from(audio.bytes).toString("base64")}`, seconds: audio.seconds };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo generar el audio." };
  }
}
