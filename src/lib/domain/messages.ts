import { db } from "../db";
import { openRouterTranscriber, type Transcriber } from "../ai/transcribe";
import { AUDIO_MAX_BYTES, blobStore, type AudioFile, type MediaStore } from "../media";
import { decodePcm, encodeOggOpus } from "../voice-note";
import { DomainError } from "./leads";

export type MediaDeps = { store?: MediaStore; transcribe?: Transcriber };

/** Quién manda la nota de voz: el cliente o un ejecutivo del equipo. */
type VoiceNoteAuthor = { author: "CONTACT" } | { author: "USER"; userId: string };

/**
 * Guarda una nota de voz: se sube el archivo, se crea el mensaje y se transcribe para que la IA
 * (y el equipo) sepan qué se dijo. Si la transcripción falla, el mensaje queda igual, sin
 * transcripción, y la IA sabe que no la pudo escuchar.
 */
async function saveVoiceNote(
  leadId: string,
  from: VoiceNoteAuthor,
  file: AudioFile,
  deps: MediaDeps,
  extra: { externalId?: string; stored?: AudioFile } = {},
) {
  if (!file.bytes.byteLength) throw new DomainError("El archivo de audio está vacío.");
  if (file.bytes.byteLength > AUDIO_MAX_BYTES) {
    throw new DomainError(`El audio pesa más de ${AUDIO_MAX_BYTES / 1024 / 1024} MB.`);
  }
  if (file.mimeType && !file.mimeType.startsWith("audio/")) throw new DomainError("El archivo no es un audio.");

  const stored = extra.stored ?? file;
  const url = await (deps.store ?? blobStore)(stored, `leads/${leadId}`);
  const message = await db.message.create({
    data: {
      leadId,
      ...from,
      ...(extra.externalId ? { externalId: extra.externalId } : {}),
      body: "",
      mediaUrl: url,
      mediaType: stored.mimeType || "audio/ogg",
    },
  });

  let transcript: string | null = null;
  try {
    transcript = await (deps.transcribe ?? openRouterTranscriber())(file);
  } catch (err) {
    console.error(`[audio] lead ${leadId}, mensaje ${message.id}:`, err);
  }
  if (transcript === null) return message;
  return db.message.update({ where: { id: message.id }, data: { transcript } });
}

/** Llega una nota de voz del cliente (`externalId`: id del mensaje en el canal). */
export function receiveContactAudio(leadId: string, file: AudioFile, deps: MediaDeps = {}, externalId?: string) {
  return saveVoiceNote(leadId, { author: "CONTACT" }, file, deps, externalId ? { externalId } : {});
}

/**
 * Un ejecutivo responde con una nota de voz grabada desde el chat. La grabadora entrega WAV y
 * WhatsApp no lo acepta, así que ahí se guarda convertida a Ogg/Opus (nota de voz normal); la
 * transcripción se hace igual con el WAV original.
 */
export async function sendUserAudio(leadId: string, userId: string, file: AudioFile, deps: MediaDeps = {}) {
  const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId }, select: { contact: { select: { channel: true } } } });
  const stored = lead.contact.channel === "WHATSAPP" && isWav(file) ? wavToVoiceNote(file) : undefined;
  return saveVoiceNote(leadId, { author: "USER", userId }, file, deps, stored ? { stored } : {});
}

function isWav(file: AudioFile) {
  const type = file.mimeType.split(";")[0].trim().toLowerCase();
  return ["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"].includes(type) || /\.wav$/i.test(file.fileName);
}

function wavToVoiceNote(file: AudioFile): AudioFile {
  let samples: Float32Array;
  let sampleRate: number;
  try {
    ({ samples, sampleRate } = decodePcm(file.bytes));
  } catch {
    throw new DomainError("No se pudo leer la grabación. Intenta grabarla de nuevo.");
  }
  return {
    bytes: encodeOggOpus(samples, sampleRate),
    mimeType: "audio/ogg",
    fileName: file.fileName.replace(/\.wav$/i, "") + ".ogg",
  };
}
