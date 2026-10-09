import { db } from "../db";
import { openRouterTranscriber, type Transcriber } from "../ai/transcribe";
import { AUDIO_MAX_BYTES, blobStore, type AudioFile, type MediaStore } from "../media";
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
  extra: { externalId?: string } = {},
) {
  if (!file.bytes.byteLength) throw new DomainError("El archivo de audio está vacío.");
  if (file.bytes.byteLength > AUDIO_MAX_BYTES) {
    throw new DomainError(`El audio pesa más de ${AUDIO_MAX_BYTES / 1024 / 1024} MB.`);
  }
  if (file.mimeType && !file.mimeType.startsWith("audio/")) throw new DomainError("El archivo no es un audio.");

  const url = await (deps.store ?? blobStore)(file, `leads/${leadId}`);
  const message = await db.message.create({
    data: { leadId, ...from, ...extra, body: "", mediaUrl: url, mediaType: file.mimeType || "audio/ogg" },
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

/** Un ejecutivo responde con una nota de voz grabada desde el chat. */
export function sendUserAudio(leadId: string, userId: string, file: AudioFile, deps: MediaDeps = {}) {
  return saveVoiceNote(leadId, { author: "USER", userId }, file, deps);
}
