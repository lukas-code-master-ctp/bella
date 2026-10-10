import { db } from "../db";
import { blobStore, fileKind, type AudioFile, type MediaStore } from "../media";
import { normalize } from "../text";
import { DomainError } from "./leads";

/** Tope de un archivo subido desde Bella (Vercel no acepta cuerpos de más de 4,5 MB). Más grande: por enlace. */
export const FILE_MAX_BYTES = 4 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  mp4: "video/mp4",
  "3gp": "video/3gpp",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const KIND_LABEL = { image: "imagen", video: "video", document: "documento", audio: "audio" } as const;

export function kindLabel(mimeType: string) {
  return KIND_LABEL[fileKind(mimeType)];
}

function mimeFromName(name: string) {
  return MIME_BY_EXT[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

export type NewMediaFile = {
  title: string;
  description: string;
  /** Archivo subido, o en su lugar `url`: un enlace público (para archivos de más de 4 MB). */
  file?: AudioFile | null;
  url?: string;
};

export async function addMediaFile(input: NewMediaFile, store: MediaStore = blobStore) {
  const title = input.title.trim();
  if (!title) throw new DomainError("Ponle un nombre al archivo.");
  if (input.file?.bytes.byteLength) {
    const { file } = input;
    if (file.bytes.byteLength > FILE_MAX_BYTES) {
      throw new DomainError(`El archivo pesa más de ${FILE_MAX_BYTES / 1024 / 1024} MB: súbelo a otro sitio y pega el enlace.`);
    }
    const mimeType = file.mimeType || mimeFromName(file.fileName);
    if (fileKind(mimeType) === "audio") throw new DomainError("Los audios no se pueden cargar aquí.");
    const url = await store({ ...file, mimeType }, "archivos");
    return db.mediaFile.create({
      data: { title, description: input.description.trim(), url, mimeType, fileName: file.fileName, size: file.bytes.byteLength },
    });
  }
  const link = input.url?.trim() ?? "";
  if (!link) throw new DomainError("Sube un archivo o pega un enlace.");
  let parsed: URL;
  try {
    parsed = new URL(link);
  } catch {
    throw new DomainError("El enlace no es válido.");
  }
  if (parsed.protocol !== "https:") throw new DomainError("El enlace debe empezar con https://.");
  const fileName = decodeURIComponent(parsed.pathname.split("/").pop() || "") || title;
  return db.mediaFile.create({
    data: { title, description: input.description.trim(), url: link, mimeType: mimeFromName(fileName), fileName },
  });
}

export async function updateMediaFile(id: string, data: { title: string; description: string }) {
  const title = data.title.trim();
  if (!title) throw new DomainError("Ponle un nombre al archivo.");
  return db.mediaFile.update({ where: { id }, data: { title, description: data.description.trim() } });
}

/** El archivo deja de estar disponible para la IA; los ya enviados siguen en las conversaciones. */
export async function deleteMediaFile(id: string) {
  await db.mediaFile.delete({ where: { id } });
}

export type FileForPrompt = { title: string; description: string; kind: string };

/** Catálogo de archivos que la IA puede enviar (va en sus instrucciones). */
export async function filesForPrompt(): Promise<FileForPrompt[]> {
  const files = await db.mediaFile.findMany({ orderBy: { title: "asc" } });
  return files.map((f) => ({ title: f.title, description: f.description, kind: kindLabel(f.mimeType) }));
}

/**
 * La IA envía un archivo del catálogo al lead: queda como un mensaje suyo con el archivo (y el
 * texto opcional como pie) y sale por el canal junto con la respuesta del turno.
 */
export async function sendMediaFile(leadId: string, title: string, caption = "") {
  const files = await db.mediaFile.findMany({ orderBy: { title: "asc" } });
  const target = normalize(title);
  const file = files.find((f) => normalize(f.title) === target);
  if (!file) {
    throw new DomainError(
      files.length
        ? `Archivo desconocido. Archivos disponibles: ${files.map((f) => f.title).join(", ")}`
        : "No hay archivos cargados para enviar.",
    );
  }
  await db.message.create({
    data: {
      leadId,
      author: "AI",
      body: caption.trim(),
      mediaUrl: file.url,
      mediaType: file.mimeType,
      mediaName: file.fileName,
    },
  });
  return file;
}
