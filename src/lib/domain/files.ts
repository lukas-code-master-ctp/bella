import { db } from "../db";
import { blobStore, fileKind, type AudioFile, type MediaStore } from "../media";
import { normalize } from "../text";
import { leadUploadFolder, META_MAX_BYTES } from "../file-limits";
import { DomainError } from "./leads";

const MB = 1024 * 1024;

/** Tope de un archivo subido desde Beliapp (Vercel no acepta cuerpos de más de 4,5 MB). Más grande: por enlace. */
export const FILE_MAX_BYTES = 4 * MB;

export { META_MAX_BYTES };

const KIND_PLURAL = { image: "imágenes", video: "videos", audio: "audios", document: "documentos" } as const;
const mb = (bytes: number) => `${bytes / MB} MB`;

function checkMetaSize(fileName: string, mimeType: string, bytes: number) {
  const kind = fileKind(mimeType);
  if (bytes > META_MAX_BYTES[kind]) {
    throw new DomainError(`"${fileName}" pesa ${(bytes / MB).toFixed(1)} MB y WhatsApp acepta hasta ${mb(META_MAX_BYTES[kind])} en ${KIND_PLURAL[kind]}.`);
  }
}

/** Peso de un archivo por enlace según el servidor (null si no lo informa o no responde). */
async function remoteSize(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(5000) });
    const length = Number(res.headers.get("content-length"));
    return res.ok && length > 0 ? length : null;
  } catch {
    return null;
  }
}

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
    const mimeType = file.mimeType || mimeFromName(file.fileName);
    if (fileKind(mimeType) === "audio") throw new DomainError("Los audios no se pueden cargar aquí.");
    checkMetaSize(file.fileName, mimeType, file.bytes.byteLength);
    if (file.bytes.byteLength > FILE_MAX_BYTES) {
      throw new DomainError(`"${file.fileName}" pesa más de ${mb(FILE_MAX_BYTES)}: súbelo a otro sitio y pega el enlace.`);
    }
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
  const mimeType = mimeFromName(fileName);
  const size = await remoteSize(link);
  if (size) checkMetaSize(fileName, mimeType, size);
  return db.mediaFile.create({
    data: { title, product, description, url: link, mimeType, fileName, size },
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
  await createFileMessages(leadId, { author: "AI" }, sent, caption);
  return { sent, skipped: chosen.length - sent.length };
}

type FileAuthor = { author: "AI" } | { author: "USER"; userId: string };
type OutgoingFile = { url: string; mimeType: string; fileName: string };

/**
 * Deja cada archivo como un mensaje por enviar (el texto opcional va de pie en el primero), en el
 * mismo orden en que salen por el canal (se entregan por fecha de creación).
 */
async function createFileMessages(leadId: string, from: FileAuthor, files: OutgoingFile[], caption: string) {
  const base = Date.now();
  for (const [i, file] of files.entries()) {
    await db.message.create({
      data: {
        leadId,
        ...from,
        body: i === 0 ? caption.trim() : "",
        mediaUrl: file.url,
        mediaType: file.mimeType,
        mediaName: file.fileName,
        createdAt: new Date(base + i),
      },
    });
  }
}

/** Un ejecutivo manda desde el chat archivos de la biblioteca (Conocimiento → Archivos). */
export async function sendLibraryFiles(leadId: string, userId: string, ids: string[], caption = "") {
  if (!ids.length) throw new DomainError("Elige al menos un archivo.");
  if (ids.length > SEND_MAX_FILES) throw new DomainError(`Puedes mandar hasta ${SEND_MAX_FILES} archivos a la vez.`);
  const wanted = new Set(ids);
  const files = (await catalog()).filter((f) => wanted.has(f.id));
  if (files.length !== wanted.size) throw new DomainError("Uno de los archivos ya no está en la biblioteca.");
  await createFileMessages(leadId, { author: "USER", userId }, files, caption);
  return files;
}

/** Archivo que el navegador del ejecutivo ya subió directo a Vercel Blob (ver la ruta upload del lead). */
export type UploadedFile = { url: string; fileName: string; mimeType: string; size: number };

const BLOB_HOST = ".public.blob.vercel-storage.com";
/** Se guarda como documento: así WhatsApp lo acepta hasta 100 MB. */
const AS_DOCUMENT = "application/octet-stream";

/**
 * Tipo con que se guarda y se envía el archivo. Un video más pesado de lo que WhatsApp acepta
 * como video (16 MB) va como documento: el cliente lo descarga y lo abre igual, sin reproducirlo
 * dentro del chat.
 */
export function sendableMimeType(mimeType: string, size: number) {
  return fileKind(mimeType) === "video" && size > META_MAX_BYTES.video ? AS_DOCUMENT : mimeType;
}

/** Un ejecutivo manda un archivo de su equipo o celular, ya subido por el navegador. */
export async function sendUploadedFile(leadId: string, userId: string, file: UploadedFile, caption = "") {
  let url: URL;
  try {
    url = new URL(file.url);
  } catch {
    throw new DomainError("No se pudo subir el archivo. Intenta de nuevo.");
  }
  // Solo enlaces de nuestro almacenamiento y de la carpeta de este lead, no cualquier URL.
  if (url.protocol !== "https:" || !url.hostname.endsWith(BLOB_HOST) || !url.pathname.startsWith(`/${leadUploadFolder(leadId)}/`)) {
    throw new DomainError("No se pudo subir el archivo. Intenta de nuevo.");
  }
  const fileName = file.fileName.trim() || "archivo";
  const declared = file.mimeType || mimeFromName(fileName);
  if (fileKind(declared) === "audio") throw new DomainError("Para mandar audio, graba una nota de voz con el micrófono.");
  if (!file.size) throw new DomainError(`"${fileName}" está vacío.`);
  const mimeType = sendableMimeType(declared, file.size);
  checkMetaSize(fileName, mimeType, file.size);
  await createFileMessages(leadId, { author: "USER", userId }, [{ url: file.url, mimeType, fileName }], caption);
}

const label = (f: { title: string; product: string }) => (f.product ? `${f.title} (${f.product})` : f.title);
