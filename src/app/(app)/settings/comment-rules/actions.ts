"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createCommentRule, deleteCommentRule, parseKeywords, setCommentRuleActive } from "@/lib/domain/comment-rules";
import { DomainError } from "@/lib/domain/leads";

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

/** El select de publicación manda `{"id","channel","label"}` en JSON, o vacío para todas. */
function parsePost(form: FormData): { id: string; channel: "INSTAGRAM" | "FACEBOOK" | null; label: string | null } | null {
  const manual = str(form, "postIdManual");
  if (manual) return { id: manual, channel: null, label: null };
  const raw = str(form, "post");
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as { id?: string; channel?: string; label?: string };
    if (!p.id) return null;
    return { id: p.id, channel: p.channel === "FACEBOOK" ? "FACEBOOK" : p.channel === "INSTAGRAM" ? "INSTAGRAM" : null, label: p.label ?? null };
  } catch {
    return null;
  }
}

export async function createCommentRuleAction(_prev: string | null, form: FormData): Promise<string | null> {
  await requireAdmin();
  const post = parsePost(form);
  const channel = str(form, "channel");
  const moderation = str(form, "moderation");
  try {
    await createCommentRule({
      name: str(form, "name"),
      // Una publicación es de una sola red: la regla queda en esa.
      channel: post?.channel ?? (channel === "INSTAGRAM" || channel === "FACEBOOK" ? channel : null),
      postId: post?.id ?? null,
      postLabel: post?.label ?? null,
      keywords: parseKeywords(str(form, "keywords")),
      publicReply: str(form, "publicReply") || null,
      privateReply: str(form, "privateReply") || null,
      hide: moderation === "hide",
      remove: moderation === "remove",
    });
  } catch (e) {
    if (e instanceof DomainError) return e.message;
    throw e;
  }
  revalidatePath("/settings/comment-rules");
  return "Regla creada. Queda inactiva hasta que la actives.";
}

export async function toggleCommentRuleAction(id: string, active: boolean) {
  await requireAdmin();
  await setCommentRuleActive(id, active);
  revalidatePath("/settings/comment-rules");
}

export async function deleteCommentRuleAction(id: string) {
  await requireAdmin();
  await deleteCommentRule(id);
  revalidatePath("/settings/comment-rules");
}
