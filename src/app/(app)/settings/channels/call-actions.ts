"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { saveCallSettings } from "@/lib/domain/calls";
import { DomainError } from "@/lib/domain/leads";

export async function saveCallsAction(_prev: string | null, form: FormData): Promise<string | null> {
  await requireAdmin();
  try {
    await saveCallSettings({ enabled: form.get("enabled") === "on" });
  } catch (e) {
    if (e instanceof DomainError) return e.message;
    throw e;
  }
  revalidatePath("/", "layout");
  return "Guardado.";
}
