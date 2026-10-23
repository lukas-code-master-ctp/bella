"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { afterInCompany } from "@/lib/company-request";
import {
  cancelEmailBroadcast,
  createEmailBroadcast,
  pauseEmailBroadcast,
  previewEmailBroadcast,
  resumeEmailBroadcast,
  runEmailBroadcasts,
  sendEmailBroadcastTest,
  type EmailBroadcastInput,
} from "@/lib/domain/email-broadcasts";
import { DomainError } from "@/lib/domain/leads";

export type EmailPreviewResult = Awaited<ReturnType<typeof previewEmailBroadcast>> | { error: string };

export async function previewEmailBroadcastAction(input: EmailBroadcastInput): Promise<EmailPreviewResult> {
  await requireAdmin();
  try {
    return await previewEmailBroadcast(input);
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
}

export async function createEmailBroadcastAction(input: EmailBroadcastInput): Promise<{ error: string }> {
  const user = await requireAdmin();
  let id: string;
  try {
    id = (await createEmailBroadcast(input, user.id)).id;
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  // La primera tanda sale apenas se crea; el resto, con el cron cada 5 minutos.
  await afterInCompany(() => runEmailBroadcasts());
  revalidatePath("/broadcasts");
  redirect(`/broadcasts/email/${id}`);
}

export async function sendEmailTestAction(input: EmailBroadcastInput, to: string): Promise<{ ok: string } | { error: string }> {
  const user = await requireAdmin();
  try {
    const address = await sendEmailBroadcastTest(input, to, { testerName: user.name });
    return { ok: `Prueba enviada a ${address}. Revisa también la carpeta de spam.` };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
}

export async function pauseEmailBroadcastAction(id: string) {
  await requireAdmin();
  await pauseEmailBroadcast(id);
  revalidatePath(`/broadcasts/email/${id}`);
}

export async function resumeEmailBroadcastAction(id: string) {
  await requireAdmin();
  await resumeEmailBroadcast(id);
  await afterInCompany(() => runEmailBroadcasts());
  revalidatePath(`/broadcasts/email/${id}`);
}

export async function cancelEmailBroadcastAction(id: string) {
  await requireAdmin();
  await cancelEmailBroadcast(id);
  revalidatePath(`/broadcasts/email/${id}`);
}
