import { db } from "./db";
import { score, tokens } from "./text";

/**
 * Hasta este tamaño (unos 15 mil tokens) la base de conocimiento va completa en las
 * instrucciones de la asistente, que quedan en caché; más grande, la busca con search_knowledge.
 */
export const KNOWLEDGE_INLINE_MAX_CHARS = 60_000;

/** Busca en la base de conocimiento y devuelve los documentos más relevantes completos. */
export async function searchKnowledge(query: string, limit = 3) {
  const docs = await db.knowledgeDoc.findMany();
  const q = tokens(query);
  return docs
    .map((d) => ({ doc: d, score: score(q, `${d.title} ${d.title} ${d.content}`) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => ({ title: r.doc.title, content: r.doc.content }));
}

/** Documentos para incluir completos en las instrucciones, o null si la base es demasiado grande. */
export async function knowledgeForPrompt() {
  const docs = await db.knowledgeDoc.findMany({
    select: { title: true, content: true },
    orderBy: { title: "asc" },
  });
  const size = docs.reduce((n, d) => n + d.title.length + d.content.length, 0);
  return size <= KNOWLEDGE_INLINE_MAX_CHARS ? docs : null;
}
