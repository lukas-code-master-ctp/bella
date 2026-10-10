import { put } from "@vercel/blob";

export const BLOB_MISSING =
  "Falta conectar un Blob store de Vercel al proyecto (Storage → Blob) para guardar las notas de voz.";

/** Archivo que la IA envía: imagen, video o documento (las notas de voz van aparte). */
export type FileKind = "image" | "video" | "document";

/** Cómo se envía un archivo por WhatsApp y Messenger, según su tipo MIME. */
export function fileKind(mimeType: string | null): FileKind | "audio" {
  const mime = (mimeType ?? "").split(";")[0].trim().toLowerCase();
  if (mime.startsWith("audio/")) return "audio";
  // WhatsApp solo acepta JPEG y PNG como imagen, y MP4 o 3GPP como video; lo demás va como documento.
  if (mime === "image/jpeg" || mime === "image/png") return "image";
  if (mime === "video/mp4" || mime === "video/3gpp") return "video";
  return "document";
}

/** Tope de una nota de voz: Vercel no acepta cuerpos de más de 4,5 MB en una función. */
export const AUDIO_MAX_BYTES = 4 * 1024 * 1024;

export type AudioFile = { bytes: Uint8Array; mimeType: string; fileName: string };

/** Guarda un archivo y devuelve su URL. Se puede reemplazar en pruebas. */
export type MediaStore = (file: AudioFile, folder: string) => Promise<string>;

/**
 * Vercel Blob: al conectar un Blob store al proyecto, Vercel agrega BLOB_STORE_ID (y la librería se
 * autentica con el token OIDC del despliegue) o, en conexiones antiguas, BLOB_READ_WRITE_TOKEN. La URL lleva un sufijo aleatorio, así que no se puede adivinar.
 */
export const blobStore: MediaStore = async (file, folder) => {
  if (!process.env.BLOB_STORE_ID && !process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error(BLOB_MISSING);
  }
  const name = file.fileName.replace(/[^\w.-]+/g, "_") || "audio";
  const blob = await put(`${folder}/${name}`, Buffer.from(file.bytes), {
    access: "public",
    contentType: file.mimeType,
    addRandomSuffix: true,
  });
  return blob.url;
};

const FORMAT_BY_MIME: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/aac": "aac",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/aiff": "aiff",
  "audio/x-aiff": "aiff",
  "audio/webm": "webm",
};

const FORMAT_BY_EXT: Record<string, string> = {
  ogg: "ogg",
  oga: "ogg",
  opus: "ogg",
  mp3: "mp3",
  wav: "wav",
  aac: "aac",
  m4a: "m4a",
  mp4: "m4a",
  flac: "flac",
  aif: "aiff",
  aiff: "aiff",
  webm: "webm",
};

/** Formato de audio que espera la API ("ogg", "mp3"…), según el tipo MIME o la extensión. */
export function audioFormat(mimeType: string, fileName: string): string | null {
  const mime = mimeType.split(";")[0].trim().toLowerCase();
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return FORMAT_BY_MIME[mime] ?? FORMAT_BY_EXT[ext] ?? null;
}
