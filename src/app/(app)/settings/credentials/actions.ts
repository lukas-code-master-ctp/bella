"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { CREDENTIAL_KEYS, saveCredentials } from "@/lib/credentials";
import { sendTestEmail } from "@/lib/domain/email-notifications";

export async function saveCredentialsAction(form: FormData) {
  await requireAdmin();
  const values = Object.fromEntries(CREDENTIAL_KEYS.map((k) => [k, String(form.get(k) ?? "")]));
  const clear = form.getAll("clear").map(String);
  await saveCredentials(values, clear);
  revalidatePath("/settings", "layout");
}

/** Manda un correo de prueba a quien aprieta el botón. Devuelve el resultado para mostrarlo. */
export async function sendTestEmailAction(): Promise<{ ok: boolean; message: string }> {
  const user = await requireAdmin();
  try {
    await sendTestEmail(user.email);
    return { ok: true, message: `Correo de prueba enviado a ${user.email}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
