"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { afterInCompany } from "@/lib/company-request";
import {
  cancelBroadcast,
  createBroadcast,
  pauseBroadcast,
  previewBroadcast,
  resumeBroadcast,
  runBroadcasts,
  sendBroadcastNow,
  sendBroadcastTest,
  type BroadcastInput,
} from "@/lib/domain/broadcasts";
import { submitTemplate } from "@/lib/channels/whatsapp";
import { templateDraftError, templateDraftParams, type TemplateDraft } from "@/lib/domain/broadcast-templates";
import { DomainError } from "@/lib/domain/leads";

export type PreviewResult = Awaited<ReturnType<typeof previewBroadcast>> | { error: string };

export async function previewBroadcastAction(input: BroadcastInput): Promise<PreviewResult> {
  await requireAdmin();
  try {
    return await previewBroadcast(input);
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
}

export async function createBroadcastAction(input: BroadcastInput): Promise<{ error: string }> {
  const user = await requireAdmin();
  let id: string;
  try {
    id = (await createBroadcast(input, user.id)).id;
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  // La primera tanda sale apenas se crea (si no está programado); el resto, con el cron cada 5 minutos.
  if (!input.scheduledAt) await afterInCompany(() => runBroadcasts());
  revalidatePath("/broadcasts");
  redirect(`/broadcasts/${id}`);
}

export async function pauseBroadcastAction(id: string) {
  await requireAdmin();
  await pauseBroadcast(id);
  revalidatePath(`/broadcasts/${id}`);
}

export async function resumeBroadcastAction(id: string) {
  await requireAdmin();
  await resumeBroadcast(id);
  await afterInCompany(() => runBroadcasts());
  revalidatePath(`/broadcasts/${id}`);
}

export async function cancelBroadcastAction(id: string) {
  await requireAdmin();
  await cancelBroadcast(id);
  revalidatePath(`/broadcasts/${id}`);
}

export async function sendBroadcastNowAction(id: string) {
  await requireAdmin();
  await sendBroadcastNow(id);
  await afterInCompany(() => runBroadcasts());
  revalidatePath(`/broadcasts/${id}`);
  revalidatePath("/broadcasts");
}

/** Prueba a un número del equipo: no crea lead ni queda en el envío. */
export async function sendBroadcastTestAction(input: BroadcastInput, to: string): Promise<{ ok: string } | { error: string }> {
  await requireAdmin();
  try {
    const { phone } = await sendBroadcastTest(input, to);
    return { ok: `Prueba enviada a ${phone}. Revisa tu WhatsApp.` };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
}

/** Crea la plantilla en Meta; queda en revisión y aparece en la lista cuando la aprueben. */
export async function submitBroadcastTemplateAction(draft: TemplateDraft): Promise<{ ok: string } | { error: string }> {
  await requireAdmin();
  const invalid = templateDraftError(draft);
  if (invalid) return { error: invalid };
  try {
    const examples = draft.examples.slice(0, templateDraftParams(draft.text)).map((e) => e.trim());
    await submitTemplate({ name: draft.name, language: draft.language, text: draft.text.trim(), category: draft.category, examples });
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  revalidatePath("/broadcasts/new");
  return { ok: "Enviada a Meta para revisión. Suele tardar minutos u horas; cuando la aprueben aparece en la lista." };
}
