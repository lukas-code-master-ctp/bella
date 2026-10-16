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
  type BroadcastInput,
} from "@/lib/domain/broadcasts";
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
  // La primera tanda sale apenas se crea; el resto, con el cron cada 5 minutos.
  await afterInCompany(() => runBroadcasts());
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
