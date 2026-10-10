"use server";

import { revalidatePath } from "next/cache";
import type { Channel } from "@prisma/client";
import { requireAdmin } from "@/lib/auth";
import { createVariant, deleteVariant, updateVariant } from "@/lib/domain/ab-tests";
import { DomainError } from "@/lib/domain/leads";
import { CHANNEL_LABEL } from "@/lib/labels";

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

function fields(form: FormData) {
  return {
    name: str(form, "name"),
    assistantName: str(form, "assistantName"),
    instructions: str(form, "instructions"),
    weight: Number(str(form, "weight") || "0"),
    active: form.get("active") === "on",
  };
}

async function run(fn: () => Promise<unknown>): Promise<string | null> {
  await requireAdmin();
  try {
    await fn();
  } catch (e) {
    if (e instanceof DomainError) return e.message;
    throw e;
  }
  revalidatePath("/settings/ab-tests");
  return null;
}

export async function createVariantAction(_prev: string | null, form: FormData): Promise<string | null> {
  const channel = str(form, "channel");
  if (!(channel in CHANNEL_LABEL)) return "Elige un canal.";
  return run(() => createVariant({ ...fields(form), channel: channel as Channel }));
}

export async function updateVariantAction(id: string, _prev: string | null, form: FormData): Promise<string | null> {
  return run(() => updateVariant(id, fields(form)));
}

export async function deleteVariantAction(id: string, _prev: string | null): Promise<string | null> {
  return run(() => deleteVariant(id));
}
