"use server";

import { revalidatePath } from "next/cache";
import { renewSession, requireUser } from "@/lib/auth";
import { DomainError } from "@/lib/domain/leads";
import { changeOwnPassword, updateOwnName } from "@/lib/domain/profile";
import { createQuickReply, deleteQuickReply, updateQuickReply } from "@/lib/domain/quick-replies";

export type ProfileState = { ok: boolean; message: string } | null;

async function run(fn: () => Promise<unknown>, success: string): Promise<ProfileState> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, message: e.message };
    throw e;
  }
  return { ok: true, message: success };
}

export async function updateNameAction(_prev: ProfileState, form: FormData): Promise<ProfileState> {
  const user = await requireUser();
  const result = await run(() => updateOwnName(user.id, String(form.get("name") ?? "")), "Nombre guardado.");
  // El nombre aparece en el menú lateral de todas las pantallas.
  if (result?.ok) revalidatePath("/", "layout");
  return result;
}

export async function changePasswordAction(_prev: ProfileState, form: FormData): Promise<ProfileState> {
  const user = await requireUser();
  const next = String(form.get("password") ?? "");
  if (next !== String(form.get("confirm") ?? "")) return { ok: false, message: "Las contraseñas nuevas no coinciden." };
  const result = await run(
    () => changeOwnPassword(user.id, String(form.get("current") ?? ""), next),
    "Contraseña cambiada. Se cerró la sesión en tus otros dispositivos.",
  );
  if (result?.ok) await renewSession();
  return result;
}

const quickReplyInput = (form: FormData) => ({ name: String(form.get("name") ?? ""), body: String(form.get("body") ?? "") });

/** Crea (sin `id`) o edita una respuesta rápida propia. */
export async function saveQuickReplyAction(id: string | null, _prev: ProfileState, form: FormData): Promise<ProfileState> {
  const user = await requireUser();
  const result = await run(
    () => (id ? updateQuickReply(user.id, id, quickReplyInput(form)) : createQuickReply(user.id, quickReplyInput(form))),
    id ? "Respuesta guardada." : "Respuesta creada.",
  );
  if (result?.ok) revalidatePath("/", "layout");
  return result;
}

export async function deleteQuickReplyAction(id: string): Promise<void> {
  const user = await requireUser();
  await deleteQuickReply(user.id, id);
  revalidatePath("/", "layout");
}
