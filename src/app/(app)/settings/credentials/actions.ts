"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { CREDENTIAL_KEYS, saveCredentials } from "@/lib/credentials";

export async function saveCredentialsAction(form: FormData) {
  await requireAdmin();
  const values = Object.fromEntries(CREDENTIAL_KEYS.map((k) => [k, String(form.get(k) ?? "")]));
  const clear = form.getAll("clear").map(String);
  await saveCredentials(values, clear);
  revalidatePath("/settings", "layout");
}

