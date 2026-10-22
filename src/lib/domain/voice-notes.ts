import type { Channel, Message } from "@prisma/client";
import { getSetting, setSetting } from "../settings";

/**
 * Notas de voz de la IA: en vez de texto, la asistente responde con un audio generado con un
 * modelo de voz de OpenRouter. Apagado por defecto: cada empresa lo enciende y elige la voz.
 */
export type VoiceNoteSettings = {
  enabled: boolean;
  /** "audio": solo cuando el cliente mandó una nota de voz; "always": en toda respuesta que se pueda. */
  mode: "audio" | "always";
  /** Modelo de voz de OpenRouter (ej. google/gemini-3.8-flash-tts). */
  model: string;
  /** Voz del modelo (ej. Kore). Vacía: la voz por defecto del modelo. */
  voice: string;
  /** Tono, acento y ritmo. Lo usan los modelos que aceptan instrucciones (Gemini, Fish Audio). */
  instructions: string;
  /** Respuestas más largas van en texto: un audio largo cansa y WhatsApp lo muestra mal. */
  maxChars: number;
};

export const DEFAULT_VOICE_MODEL = "google/gemini-3.8-flash-tts";

export const DEFAULT_VOICE_NOTES: VoiceNoteSettings = {
  enabled: false,
  mode: "audio",
  model: DEFAULT_VOICE_MODEL,
  voice: "Kore",
  instructions:
    "Habla en español latinoamericano, con tono cálido, cercano y natural, como alguien que manda " +
    "una nota de voz por WhatsApp. Ritmo tranquilo, sin sonar a locutor.",
  maxChars: 600,
};

export const VOICE_MAX_CHARS_LIMIT = 1500;

export async function getVoiceNoteSettings(): Promise<VoiceNoteSettings> {
  return { ...DEFAULT_VOICE_NOTES, ...(await getSetting<Partial<VoiceNoteSettings>>("voiceNotes", {})) };
}

export async function saveVoiceNoteSettings(s: VoiceNoteSettings) {
  await setSetting<VoiceNoteSettings>("voiceNotes", s);
}

/** Canales donde la IA puede mandar notas de voz (el simulador, para probarlas). */
const VOICE_CHANNELS: Channel[] = ["WHATSAPP", "SIMULATOR"];

const isVoiceNote = (m: Pick<Message, "mediaUrl" | "mediaType">) => Boolean(m.mediaUrl && m.mediaType?.startsWith("audio/"));

/** Un link, un correo o una lista se leen mejor que se escuchan: esas respuestas van en texto. */
export function speakable(reply: string, maxChars: number): boolean {
  const text = reply.trim();
  if (!text || text.length > maxChars) return false;
  if (/https?:\/\/|www\.|\S+@\S+\.\S+/i.test(text)) return false;
  return !/^\s*([-*•]|\d+[.)])\s/m.test(text);
}

/**
 * Si la próxima respuesta de la IA saldría como nota de voz (antes de saber qué va a decir): se le
 * avisa en el turno para que la escriba hablada, sin listas ni links, que la dejarían en texto.
 */
export function voiceTurnHint(
  s: VoiceNoteSettings,
  { channel, lastFromContact }: { channel: Channel; lastFromContact: Pick<Message, "mediaUrl" | "mediaType"> | null },
): string | null {
  if (!s.enabled || !VOICE_CHANNELS.includes(channel)) return null;
  if (s.mode !== "always" && !(lastFromContact && isVoiceNote(lastFromContact))) return null;
  return (
    `(Tu respuesta se enviará como nota de voz${s.mode === "always" ? "" : " porque el cliente mandó un audio"}. ` +
    "Escríbela como se diría hablando: frases corridas, sin viñetas, listas numeradas, links ni correos, " +
    `y en menos de ${s.maxChars} caracteres. Si de verdad necesitas mandar un link o una lista, ` +
    "esa respuesta saldrá en texto.)"
  );
}

/**
 * Si la respuesta de la IA sale como nota de voz. `lastFromContact`: el último mensaje del cliente
 * que se está respondiendo (null en un seguimiento).
 */
export function shouldSpeak(
  s: VoiceNoteSettings,
  reply: string,
  { channel, lastFromContact }: { channel: Channel; lastFromContact: Pick<Message, "mediaUrl" | "mediaType"> | null },
): boolean {
  if (!s.enabled || !VOICE_CHANNELS.includes(channel)) return false;
  if (!speakable(reply, s.maxChars)) return false;
  if (s.mode === "always") return true;
  return Boolean(lastFromContact && isVoiceNote(lastFromContact));
}
