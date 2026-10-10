"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { DomainError } from "@/lib/domain/leads";
import { createWebhook, deliverPendingWebhooks, sendTestWebhook } from "@/lib/domain/webhooks";

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

export async function createWebhookAction(_prev: string | null, form: FormData): Promise<string | null> {
  await requireAdmin();
  try {
    await createWebhook({ name: str(form, "name"), url: str(form, "url"), stageId: str(form, "stageId") });
  } catch (e) {
    if (e instanceof DomainError) return e.message;
    throw e;
  }
  revalidatePath("/settings/webhooks");
  return null;
}

export async function toggleWebhookAction(id: string, active: boolean) {
  await requireAdmin();
  await db.webhook.update({ where: { id }, data: { active } });
  revalidatePath("/settings/webhooks");
}

export async function deleteWebhookAction(id: string) {
  await requireAdmin();
  await db.webhook.delete({ where: { id } });
  revalidatePath("/settings/webhooks");
}

/** Envía un lead de ejemplo a la URL y devuelve cómo respondió. */
export async function testWebhookAction(id: string): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();
  return sendTestWebhook(id);
}

export async function retryWebhooksAction() {
  await requireAdmin();
  await db.webhookDelivery.updateMany({ where: { status: "FAILED" }, data: { attempts: 0 } });
  await deliverPendingWebhooks();
  revalidatePath("/settings/webhooks");
}
