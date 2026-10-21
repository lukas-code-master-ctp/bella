/* Búsqueda de respuestas rápidas en el chat del lead; sin base de datos, corre en el navegador. */

export const QUICK_REPLY_NAME_MAX = 60;
export const QUICK_REPLY_BODY_MAX = 4000;

/**
 * Filtra por lo escrito después de "/": primero las que empiezan con eso y después las que lo
 * contienen en el nombre o el texto. Sin tildes ni mayúsculas, como se escribe apurado en el chat.
 */
export function matchQuickReplies<T extends { name: string; body: string }>(replies: T[], query: string): T[] {
  const q = fold(query.trim());
  if (!q) return replies;
  const starts: T[] = [];
  const contains: T[] = [];
  for (const r of replies) {
    const name = fold(r.name);
    if (name.startsWith(q)) starts.push(r);
    else if (name.includes(q) || fold(r.body).includes(q)) contains.push(r);
  }
  return [...starts, ...contains];
}

function fold(s: string) {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}
