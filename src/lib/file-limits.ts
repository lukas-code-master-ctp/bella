// Sin dependencias del servidor: lo usa también el navegador al elegir un archivo para enviar.

const MB = 1024 * 1024;

/** Máximo que acepta WhatsApp (API de Meta) por tipo de archivo; más pesado, Meta no lo entrega. */
export const META_MAX_BYTES = { image: 5 * MB, video: 16 * MB, audio: 16 * MB, document: 100 * MB } as const;

/** Tope de un archivo subido desde el chat: lo máximo que acepta WhatsApp (en documentos). */
export const UPLOAD_MAX_BYTES = META_MAX_BYTES.document;

/** Carpeta de Vercel Blob donde quedan los archivos que el equipo manda a un lead. */
export const leadUploadFolder = (leadId: string) => `leads/${leadId}/archivos`;
