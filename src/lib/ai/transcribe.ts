import { audioFormat, type AudioFile } from "../media";
import { openRouterClient, type ChatClient } from "./providers";

/**
 * Las notas de voz se transcriben con un modelo de OpenRouter que entiende audio (la API de
 * Anthropic no recibe audio). Se puede cambiar con TRANSCRIPTION_MODEL.
 */
export const DEFAULT_TRANSCRIPTION_MODEL = "google/gemini-2.5-flash";

export type Transcriber = (file: AudioFile) => Promise<string>;

const INSTRUCTIONS =
  "Transcribe esta nota de voz, palabra por palabra, en el idioma en que habla " +
  "(normalmente español de Chile). Responde solo con la transcripción, sin comillas, comentarios " +
  "ni marcas de tiempo. Si no se entiende nada o no hay voz, responde exactamente: [inaudible]";

export function openRouterTranscriber(client: ChatClient = openRouterClient): Transcriber {
  return async (file) => {
    if (!process.env.OPENROUTER_API_KEY && client === openRouterClient) {
      throw new Error("Falta configurar OPENROUTER_API_KEY para transcribir audios.");
    }
    const format = audioFormat(file.mimeType, file.fileName);
    if (!format) throw new Error(`Formato de audio no soportado: ${file.mimeType || file.fileName}`);
    const response = await client.complete({
      model: process.env.TRANSCRIPTION_MODEL || DEFAULT_TRANSCRIPTION_MODEL,
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: INSTRUCTIONS },
            { type: "input_audio", input_audio: { data: Buffer.from(file.bytes).toString("base64"), format } },
          ],
        },
      ],
    });
    const text = (response.choices?.[0]?.message.content ?? "").trim();
    if (!text) throw new Error("El modelo no devolvió transcripción");
    return text;
  };
}
