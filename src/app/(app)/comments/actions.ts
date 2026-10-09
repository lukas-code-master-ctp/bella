"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { replyToComment, setCommentDone, setCommentHidden } from "@/lib/domain/comments";
import { DomainError } from "@/lib/domain/leads";

function done() {
  revalidatePath("/comments");
  revalidatePath("/", "layout");
}

/** Responde en público o por privado, según el botón que se apretó. */
export async function replyCommentAction(commentId: string, _prev: string | null, form: FormData): Promise<string | null> {
  const user = await requireUser();
  const mode = form.get("mode") === "private" ? "private" : "public";
  try {
    await replyToComment(commentId, mode, String(form.get("text") ?? ""), user.id);
  } catch (e) {
    if (e instanceof DomainError) return e.message;
    throw e;
  }
  done();
  return null;
}

export async function hideCommentAction(commentId: string, hidden: boolean): Promise<string | null> {
  await requireUser();
  try {
    await setCommentHidden(commentId, hidden);
  } catch (e) {
    if (e instanceof DomainError) return e.message;
    throw e;
  }
  done();
  return null;
}

export async function doneCommentAction(commentId: string, isDone: boolean) {
  await requireUser();
  await setCommentDone(commentId, isDone);
  done();
}
