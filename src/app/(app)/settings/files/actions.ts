"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { BLOB_MISSING } from "@/lib/media";
import { DomainError } from "@/lib/domain/leads";
import { addMediaFile, deleteMediaFile, updateMediaFile } from "@/lib/domain/files";

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

export async function addFileAction(_prev: string | null, form: FormData): Promise<string | null> {
  await requireAdmin();
  const upload = form.get("file");
  const file =
    upload instanceof File && upload.size > 0
      ? { bytes: new Uint8Array(await upload.arrayBuffer()), mimeType: upload.type, fileName: upload.name }
      : null;
  try {
    await addMediaFile({ title: str(form, "title"), description: str(form, "description"), file, url: str(form, "url") });
  } catch (e) {
    if (e instanceof DomainError) return e.message;
    if (e instanceof Error && e.message === BLOB_MISSING) return "Falta conectar un Blob store de Vercel (Storage → Blob) para guardar archivos.";
    console.error(e);
    return "No se pudo guardar el archivo. Intenta de nuevo.";
  }
  revalidatePath("/settings/files");
  return "Archivo agregado.";
}

export async function updateFileAction(id: string, form: FormData) {
  await requireAdmin();
  await updateMediaFile(id, { title: str(form, "title"), description: str(form, "description") });
  revalidatePath("/settings/files");
}

export async function deleteFileAction(id: string) {
  await requireAdmin();
  await deleteMediaFile(id);
  revalidatePath("/settings/files");
}
