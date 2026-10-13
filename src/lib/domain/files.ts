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
  kmz: "application/vnd.google-earth.kmz",
  kml: "application/vnd.google-earth.kml+xml",
};

const KIND_LABEL = { image: "imagen", video: "video", document: "documento", audio: "audio" } as const;

export function kindLabel(mimeType: string) {
  return KIND_LABEL[fileKind(mimeType)];
}

function mimeFromName(name: string) {
  return MIME_BY_EXT[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

export type NewMediaFile = {
  /** Vacío: se usa el nombre del archivo (sin extensión), útil al subir varios de una vez. */
  title: string;
  /** Producto o grupo (ej. un proyecto): la IA puede enviar uno o todos los archivos del grupo. */
  product?: string;
  description: string;
  /** Archivo subido, o en su lugar `url`: un enlace público (para archivos de más de 4 MB). */
  file?: AudioFile | null;
  url?: string;
};

const baseName = (fileName: string) => fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();

export async function addMediaFile(input: NewMediaFile, store: MediaStore = blobStore) {
  const product = input.product?.trim() ?? "";
  const description = input.description.trim();
  if (input.file?.bytes.byteLength) {
    const { file } = input;
    const title = input.title.trim() || baseName(file.fileName);
    if (!title) throw new DomainError("Ponle un nombre al archivo.");
    if (file.bytes.byteLength > FILE_MAX_BYTES) {
      throw new DomainError(`"${file.fileName}" pesa más de ${FILE_MAX_BYTES / 1024 / 1024} MB: súbelo a otro sitio y pega el enlace.`);
    }
    const mimeType = file.mimeType || mimeFromName(file.fileName);
    if (fileKind(mimeType) === "audio") throw new DomainError("Los audios no se pueden cargar aquí.");
    const url = await store({ ...file, mimeType }, "archivos");
    return db.mediaFile.create({
      data: { title, product, description, url, mimeType, fileName: file.fileName, size: file.bytes.byteLength },
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
  const fileName = decodeURIComponent(parsed.pathname.split("/").pop() || "") || input.title.trim();
  const title = input.title.trim() || baseName(fileName);
  if (!title) throw new DomainError("Ponle un nombre al archivo.");
  return db.mediaFile.create({
    data: { title, product, description, url: link, mimeType: mimeFromName(fileName), fileName },
  });
}

export async function updateMediaFile(id: string, data: { title: string; product?: string; description: string }) {
  const title = data.title.trim();
  if (!title) throw new DomainError("Ponle un nombre al archivo.");
  return db.mediaFile.update({
    where: { id },
    data: { title, product: data.product?.trim() ?? "", description: data.description.trim() },
  });
}

/** El archivo deja de estar disponible para la IA; los ya enviados siguen en las conversaciones. */
export async function deleteMediaFile(id: string) {
  await db.mediaFile.delete({ where: { id } });
}

const catalog = () => db.mediaFile.findMany({ orderBy: [{ product: "asc" }, { title: "asc" }] });

export type FileForPrompt = { title: string; product: string; description: string; kind: string };

/** Catálogo de archivos que la IA puede enviar (va en sus instrucciones), ordenado por producto. */
export async function filesForPrompt(): Promise<FileForPrompt[]> {
  const files = await catalog();
  return files.map((f) => ({ title: f.title, product: f.product, description: f.description, kind: kindLabel(f.mimeType) }));
}

/** Tope de archivos por envío, para no inundar el chat del cliente. */
export const SEND_MAX_FILES = 10;

/**
 * La IA envía archivos del catálogo al lead: uno (`file`, acotado por `product` si el nombre se
 * repite entre productos) o todos los de un producto (`product` sin `file`). Cada uno queda como un
 * mensaje suyo (el texto opcional va de pie en el primero) y sale por el canal junto con la
 * respuesta del turno.
 */
export async function sendMediaFiles(leadId: string, pick: { file?: string; product?: string }, caption = "") {
  const files = await catalog();
  const wantFile = normalize(pick.file ?? "");
  const wantProduct = normalize(pick.product ?? "");
  const pool = wantProduct ? files.filter((f) => normalize(f.product) === wantProduct) : files;
  if (!files.length) throw new DomainError("No hay archivos cargados para enviar.");
  if (wantProduct && !pool.length) {
    const products = [...new Set(files.map((f) => f.product).filter(Boolean))];
    throw new DomainError(`Producto sin archivos. Productos con archivos: ${products.join(", ") || "ninguno"}`);
  }
  if (!wantFile && !wantProduct) throw new DomainError("Indica el archivo o el producto.");
  const chosen = wantFile ? pool.filter((f) => normalize(f.title) === wantFile) : pool;
  if (!chosen.length) {
    throw new DomainError(`Archivo desconocido. Archivos disponibles: ${pool.map(label).join(", ")}`);
  }
  if (wantFile && chosen.length > 1) {
    throw new DomainError(`Hay varios "${chosen[0].title}": indica también el producto (${chosen.map((f) => f.product || "sin producto").join(", ")}).`);
  }
  const sent = chosen.slice(0, SEND_MAX_FILES);
  // Mismo orden en que salen por el canal (se entregan por fecha de creación).
  const base = Date.now();
  for (const [i, file] of sent.entries()) {
    await db.message.create({
      data: {
        leadId,
        author: "AI",
        body: i === 0 ? caption.trim() : "",
        mediaUrl: file.url,
        mediaType: file.mimeType,
        mediaName: file.fileName,
        createdAt: new Date(base + i),
      },
    });
  }
  return { sent, skipped: chosen.length - sent.length };
}

const label = (f: { title: string; product: string }) => (f.product ? `${f.title} (${f.product})` : f.title);
