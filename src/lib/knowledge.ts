import { db } from "./db";
import { score, tokens } from "./text";

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
