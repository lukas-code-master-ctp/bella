import type { SocialComment } from "@prisma/client";
import { db } from "../db";
import { ChannelSendError } from "../channels/whatsapp";
import { platformOf, type MessengerWebhook } from "../channels/messenger";
import { commentsApi, type CommentsApi } from "../channels/comments";
import { DomainError } from "./leads";

/** Meta permite el mensaje privado a un comentario solo dentro de 7 días. */
export const PRIVATE_REPLY_DAYS = 7;

/**
 * Guarda los comentarios nuevos de un webhook de Instagram (field "comments") o de la página
 * (field "feed", item "comment"). Ignora los de la propia cuenta, como las respuestas del equipo.
 * Devuelve los ids de los guardados, para pasarlos por las reglas de comentarios.
 */
export async function receiveComments(payload: MessengerWebhook): Promise<string[]> {
  const platform = platformOf(payload);
  if (!platform) return [];
  const own = new Set([process.env.META_PAGE_ID, process.env.META_IG_ACCOUNT_ID].filter(Boolean));
  const saved: string[] = [];
  for (const entry of payload.entry ?? []) {
    own.add(entry.id);
    for (const change of entry.changes ?? []) {
      const v = change.value;
      if (!v) continue;
      const isIg = platform === "INSTAGRAM" && change.field === "comments";
      const isFb = platform === "FACEBOOK" && change.field === "feed" && v.item === "comment" && v.verb === "add";
      if (!isIg && !isFb) continue;
      const externalId = isIg ? v.id : v.comment_id;
      const text = (isIg ? v.text : v.message) ?? "";
      if (!externalId || !text.trim() || (v.from?.id && own.has(v.from.id))) continue;
      const created = await db.socialComment
        .create({
          data: {
            channel: platform,
            externalId,
            postId: isIg ? (v.media?.id ?? null) : (v.post_id ?? null),
            parentId: v.parent_id && v.parent_id !== v.post_id ? v.parent_id : null,
            authorId: v.from?.id ?? null,
            authorName: (isIg && v.from?.username ? `@${v.from.username}` : v.from?.name) ?? "Sin nombre",
            text,
          },
        })
        .catch(() => null); // Meta reintentó un comentario ya guardado.
      if (created) saved.push(created.id);
    }
  }
  return saved;
}

export function listComments({ done = false, take = 50 } = {}) {
  return db.socialComment.findMany({
    where: { doneAt: done ? { not: null } : null },
    include: { repliedBy: { select: { name: true } }, rule: { select: { name: true } } },
    orderBy: { createdAt: done ? "desc" : "asc" },
    take,
  });
}

export function canPrivateReply(c: Pick<SocialComment, "privateAt" | "createdAt">, now = new Date()) {
  return !c.privateAt && now.getTime() - c.createdAt.getTime() < PRIVATE_REPLY_DAYS * 86_400_000;
}

function sendError(err: unknown): never {
  if (err instanceof ChannelSendError) throw new DomainError(err.message);
  console.error("[comentarios]", err);
  throw new DomainError("Meta no aceptó la acción. Intenta de nuevo.");
}

/**
 * Responde un comentario: en público (en su hilo) o por mensaje privado. Si el cliente contesta
 * el mensaje privado, la conversación entra como un lead más de Instagram o Messenger.
 */
export async function replyToComment(
  commentId: string,
  mode: "public" | "private",
  text: string,
  userId: string,
  api: CommentsApi = commentsApi,
) {
  const body = text.trim();
  if (!body) throw new DomainError("Escribe la respuesta.");
  const c = await db.socialComment.findUniqueOrThrow({ where: { id: commentId } });
  const platform = c.channel === "INSTAGRAM" ? "INSTAGRAM" : "FACEBOOK";
  if (mode === "private") {
    if (!canPrivateReply(c)) {
      throw new DomainError(
        c.privateAt
          ? "Ya se le envió un mensaje privado por este comentario."
          : `Meta solo permite el mensaje privado hasta ${PRIVATE_REPLY_DAYS} días después del comentario.`,
      );
    }
    await api.privateReply(c.externalId, body).catch(sendError);
    return db.socialComment.update({
      where: { id: c.id },
      data: { privateReply: body, privateAt: new Date(), repliedById: userId, doneAt: new Date() },
    });
  }
  await api.reply(platform, c.externalId, body).catch(sendError);
  return db.socialComment.update({
    where: { id: c.id },
    data: { reply: body, repliedAt: new Date(), repliedById: userId, doneAt: new Date() },
  });
}

export async function setCommentHidden(commentId: string, hidden: boolean, api: CommentsApi = commentsApi) {
  const c = await db.socialComment.findUniqueOrThrow({ where: { id: commentId } });
  await api.hide(c.channel === "INSTAGRAM" ? "INSTAGRAM" : "FACEBOOK", c.externalId, hidden).catch(sendError);
  return db.socialComment.update({ where: { id: c.id }, data: { hidden } });
}

/** Marca un comentario como resuelto sin responder (o lo devuelve a pendientes). */
export function setCommentDone(commentId: string, done: boolean) {
  return db.socialComment.update({ where: { id: commentId }, data: { doneAt: done ? new Date() : null } });
}

export function countPendingComments() {
  return db.socialComment.count({ where: { doneAt: null } });
}
