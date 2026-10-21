import { db } from "../db";
import { QUICK_REPLY_BODY_MAX, QUICK_REPLY_NAME_MAX } from "../quick-reply-search";
import { DomainError } from "./leads";

/*
 * Respuestas rápidas: textos pre-hechos de cada ejecutivo. Se crean en Mi perfil y se buscan en
 * el chat del lead escribiendo "/" seguido del nombre. Son personales: nadie más las ve ni edita.
 */

export type QuickReplyInput = { name: string; body: string };

function clean({ name, body }: QuickReplyInput) {
  // El nombre se busca después de "/": sin la barra inicial ni espacios repetidos.
  const n = name.trim().replace(/^\/+/, "").replace(/\s+/g, " ").trim();
  const b = body.trim();
  if (!n) throw new DomainError("Ponle un nombre a la respuesta.");
  if (n.length > QUICK_REPLY_NAME_MAX) throw new DomainError(`El nombre es muy largo (máximo ${QUICK_REPLY_NAME_MAX} caracteres).`);
  if (!b) throw new DomainError("Escribe el texto de la respuesta.");
  if (b.length > QUICK_REPLY_BODY_MAX) throw new DomainError(`El texto es muy largo (máximo ${QUICK_REPLY_BODY_MAX} caracteres).`);
  return { name: n, body: b };
}

export function listQuickReplies(userId: string) {
  return db.quickReply.findMany({
    where: { userId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, body: true },
  });
}

export async function createQuickReply(userId: string, input: QuickReplyInput) {
  return db.quickReply.create({ data: { userId, ...clean(input) } });
}

/** Solo la dueña o el dueño de la respuesta puede cambiarla o borrarla. */
async function own(userId: string, id: string) {
  const reply = await db.quickReply.findFirst({ where: { id, userId } });
  if (!reply) throw new DomainError("Esa respuesta rápida ya no existe.");
  return reply;
}

export async function updateQuickReply(userId: string, id: string, input: QuickReplyInput) {
  await own(userId, id);
  return db.quickReply.update({ where: { id }, data: clean(input) });
}

export async function deleteQuickReply(userId: string, id: string) {
  await own(userId, id);
  await db.quickReply.delete({ where: { id } });
}
