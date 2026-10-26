"use server";

import { revalidatePath } from "next/cache";
import { list } from "@vercel/blob";
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
  sendEmailBroadcastNow,
  sendEmailBroadcastTest,
  type EmailBroadcastInput,
} from "@/lib/domain/email-broadcasts";
import { DomainError } from "@/lib/domain/leads";
import { emailImageFolder } from "@/lib/file-limits";
import { currentCompanyId } from "@/lib/tenant";

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
  // La primera tanda sale apenas se crea (si no está programado); el resto, con el cron cada 5 minutos.
  if (!input.scheduledAt) await afterInCompany(() => runEmailBroadcasts());
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

export async function sendEmailBroadcastNowAction(id: string) {
  await requireAdmin();
  await sendEmailBroadcastNow(id);
  await afterInCompany(() => runEmailBroadcasts());
  revalidatePath(`/broadcasts/email/${id}`);
}

export async function cancelEmailBroadcastAction(id: string) {
  await requireAdmin();
  await cancelEmailBroadcast(id);
  revalidatePath(`/broadcasts/email/${id}`);
}

export type EmailImage = { url: string; name: string };

/** Imágenes que la empresa ya subió para sus correos, de la más nueva a la más antigua. */
export async function emailImagesAction(): Promise<EmailImage[]> {
  await requireAdmin();
  if (!process.env.BLOB_STORE_ID && !process.env.BLOB_READ_WRITE_TOKEN) return [];
  try {
    const { blobs } = await list({ prefix: `${emailImageFolder(await currentCompanyId())}/`, limit: 100 });
    return blobs
      .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())
      .map((b) => ({ url: b.url, name: b.pathname.split("/").pop()!.replace(/-[A-Za-z0-9]{20,}(?=\.\w+$)/, "") }));
  } catch (err) {
    console.error("[correo] no se pudieron listar las imágenes:", err);
    return [];
  }
}
