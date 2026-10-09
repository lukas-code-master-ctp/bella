import { db } from "../db";
import { openRouterTranscriber, type Transcriber } from "../ai/transcribe";
import { AUDIO_MAX_BYTES, blobStore, type AudioFile, type MediaStore } from "../media";
import { DomainError } from "./leads";

export type MediaDeps = { store?: MediaStore; transcribe?: Transcriber };

/**
 * Llega una nota de voz del cliente: se guarda el archivo, se crea el mensaje y se transcribe
 * para que la IA (y el ejecutivo) sepan qué dijo. Si la transcripción falla, el mensaje queda
 * igual, sin transcripción, y la IA sabe que no la pudo escuchar.
 */
export async function receiveContactAudio(leadId: string, file: AudioFile, deps: MediaDeps = {}) {
  if (!file.bytes.byteLength) throw new DomainError("El archivo de audio está vacío.");
  if (file.bytes.byteLength > AUDIO_MAX_BYTES) {
    throw new DomainError(`El audio pesa más de ${AUDIO_MAX_BYTES / 1024 / 1024} MB.`);
  }
  if (file.mimeType && !file.mimeType.startsWith("audio/")) throw new DomainError("El archivo no es un audio.");

  const url = await (deps.store ?? blobStore)(file, `leads/${leadId}`);
  const message = await db.message.create({
    data: { leadId, author: "CONTACT", body: "", mediaUrl: url, mediaType: file.mimeType || "audio/ogg" },
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
