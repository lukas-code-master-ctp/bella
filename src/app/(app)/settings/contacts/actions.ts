"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { importContactsCsv, mergeContacts, type ImportResult } from "@/lib/domain/contact-import";
import { DomainError } from "@/lib/domain/leads";

const MAX_BYTES = 5 * 1024 * 1024;

export type ImportState = { error: string } | ImportResult | null;

export async function importContactsAction(_prev: ImportState, form: FormData): Promise<ImportState> {
  const user = await requireAdmin();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Elige un archivo CSV." };
  if (file.size > MAX_BYTES) return { error: "El archivo pesa más de 5 MB: divídelo en partes." };
  try {
    const result = await importContactsCsv(await file.text(), { actor: "USER", userId: user.id }, {
      defaultCountryCode: String(form.get("countryCode") ?? "").trim(),
    });
    revalidatePath("/funnel");
    revalidatePath("/settings/contacts");
    return result;
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    console.error(e);
    return { error: "No se pudo leer el archivo. Revisa que sea un CSV con nombres de columna en la primera fila." };
  }
}

export async function mergeContactsAction(keepId: string, otherIds: string[]): Promise<string | null> {
  const user = await requireAdmin();
  try {
    await mergeContacts(keepId, otherIds, { actor: "USER", userId: user.id });
  } catch (e) {
    if (e instanceof DomainError) return e.message;
    throw e;
  }
  revalidatePath("/settings/contacts");
  revalidatePath("/funnel");
  return null;
}
