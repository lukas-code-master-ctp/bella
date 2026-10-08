/** Normaliza texto para búsquedas: minúsculas, sin tildes ni signos. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set(
  "de la el los las un una unos unas y o a en con por para que es del al se su sus lo le les mi me tu te hay tiene tienen quiero busco algun alguna cual cuanto cuanta como".split(" "),
);

export function tokens(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Puntaje simple de coincidencia: cuántos términos de la consulta aparecen en el texto. */
export function score(queryTokens: string[], haystack: string): number {
  const text = normalize(haystack);
  let total = 0;
  for (const t of queryTokens) {
    if (text.includes(t)) total += t.length > 3 ? 2 : 1;
  }
  return total;
}
