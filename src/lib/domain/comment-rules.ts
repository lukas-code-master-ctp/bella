import type { CommentRule, Prisma, SocialComment } from "@prisma/client";
import { db } from "../db";
import { commentsApi, type CommentsApi } from "../channels/comments";
import { DomainError } from "./leads";

/**
 * Reglas de comentarios: responden solas a los comentarios nuevos de una publicación (o de todas)
 * que contengan ciertas palabras. Pueden responder en público, escribir por privado al autor y
 * ocultar o borrar el comentario. Se crean inactivas, porque escriben a personas sin revisión.
 */

export type CommentRuleInput = {
  name: string;
  channel: "INSTAGRAM" | "FACEBOOK" | null;
  postId: string | null;
  postLabel: string | null;
  keywords: string[];
  publicReply: string | null;
  privateReply: string | null;
  hide: boolean;
  remove: boolean;
};

/** Minúsculas y sin tildes, para que "Información" coincida con "informacion". */
export function normalize(text: string) {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** Palabras clave separadas por coma o salto de línea, sin repetir. */
export function parseKeywords(raw: string): string[] {
  const seen = new Set<string>();
  return raw
    .split(/[,\n]/)
    .map((k) => k.trim())
    .filter((k) => k && !seen.has(normalize(k)) && seen.add(normalize(k)));
}

type Matchable = Pick<SocialComment, "channel" | "postId" | "text">;
type RuleMatch = Pick<CommentRule, "channel" | "postId" | "keywords">;

export function ruleMatches(rule: RuleMatch, c: Matchable) {
  if (rule.channel && rule.channel !== c.channel) return false;
  if (rule.postId && rule.postId !== c.postId) return false;
  if (!rule.keywords.length) return true;
  const text = normalize(c.text);
  return rule.keywords.some((k) => text.includes(normalize(k)));
}

/** La regla más específica gana: primero las de una publicación, luego las con palabras clave. */
export function pickRule<R extends RuleMatch & { createdAt: Date }>(rules: R[], c: Matchable): R | null {
  const score = (r: R) => (r.postId ? 2 : 0) + (r.keywords.length ? 1 : 0);
  return (
    rules
      .filter((r) => ruleMatches(r, c))
      .sort((a, b) => score(b) - score(a) || a.createdAt.getTime() - b.createdAt.getTime())[0] ?? null
  );
}

/** {nombre} se reemplaza por el nombre del autor (en Instagram, su @usuario). */
export function fillTemplate(template: string, authorName: string) {
  return template.replaceAll("{nombre}", authorName).trim();
}

export function validateRule(input: CommentRuleInput): CommentRuleInput {
  const name = input.name.trim();
  if (!name) throw new DomainError("Ponle un nombre a la regla.");
  const publicReply = input.publicReply?.trim() || null;
  const privateReply = input.privateReply?.trim() || null;
  if (input.remove && publicReply) throw new DomainError("Si la regla borra el comentario, no puede responderlo en público.");
  if (!publicReply && !privateReply && !input.hide && !input.remove) {
    throw new DomainError("Elige al menos una acción: responder, escribir por privado, ocultar o borrar.");
  }
  return {
    ...input,
    name,
    postId: input.postId?.trim() || null,
    postLabel: input.postId ? input.postLabel?.trim() || null : null,
    keywords: input.keywords.map((k) => k.trim()).filter(Boolean),
    publicReply,
    privateReply,
    hide: input.remove ? false : input.hide,
  };
}

export async function createCommentRule(input: CommentRuleInput) {
  return db.commentRule.create({ data: validateRule(input) });
}

export function setCommentRuleActive(id: string, active: boolean) {
  return db.commentRule.update({ where: { id }, data: { active } });
}

export function deleteCommentRule(id: string) {
  return db.commentRule.delete({ where: { id } });
}

export function listCommentRules() {
  return db.commentRule.findMany({
    include: { _count: { select: { comments: true } } },
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
  });
}

/**
 * Aplica las reglas activas a comentarios recién guardados. Solo a comentarios de primer nivel:
 * las respuestas dentro de un hilo suelen ser conversación con el equipo. Si Meta rechaza una
 * acción, el comentario queda pendiente para que lo atienda una persona.
 */
export async function applyCommentRules(commentIds: string[], api: CommentsApi = commentsApi): Promise<number> {
  if (!commentIds.length) return 0;
  const rules = await db.commentRule.findMany({ where: { active: true } });
  if (!rules.length) return 0;
  const comments = await db.socialComment.findMany({
    where: { id: { in: commentIds }, parentId: null, doneAt: null, ruleId: null },
  });
  let handled = 0;
  for (const c of comments) {
    const rule = pickRule(rules, c);
    if (!rule) continue;
    if (await runRule(rule, c, api)) handled++;
  }
  return handled;
}

async function runRule(rule: CommentRule, c: SocialComment, api: CommentsApi): Promise<boolean> {
  const platform = c.channel === "INSTAGRAM" ? "INSTAGRAM" : "FACEBOOK";
  const now = new Date();
  const data: Prisma.SocialCommentUncheckedUpdateInput = { ruleId: rule.id, doneAt: now };
  try {
    if (rule.publicReply) {
      const reply = fillTemplate(rule.publicReply, c.authorName);
      await api.reply(platform, c.externalId, reply);
      Object.assign(data, { reply, repliedAt: now });
    }
    if (rule.privateReply) {
      const text = fillTemplate(rule.privateReply, c.authorName);
      await api.privateReply(c.externalId, text);
      Object.assign(data, { privateReply: text, privateAt: now });
    }
    if (rule.remove) {
      await api.remove(c.externalId);
      data.removedAt = now;
    } else if (rule.hide) {
      await api.hide(platform, c.externalId, true);
      data.hidden = true;
    }
  } catch (err) {
    console.error(`[reglas de comentarios] "${rule.name}" falló en ${c.externalId}`, err);
    // Lo que alcanzó a hacerse queda registrado, pero el comentario sigue pendiente.
    delete data.doneAt;
    delete data.ruleId;
    await db.socialComment.update({ where: { id: c.id }, data });
    return false;
  }
  await db.socialComment.update({ where: { id: c.id }, data });
  return true;
}
