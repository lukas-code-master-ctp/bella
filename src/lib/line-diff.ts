export type DiffLine = { kind: "same" | "added" | "removed"; text: string };

/**
 * Diferencia línea por línea entre dos textos (subsecuencia común más larga). Pensada para
 * instrucciones de unos cientos de líneas: el costo es líneas de a × líneas de b.
 */
export function lineDiff(a: string, b: string): DiffLine[] {
  const x = a.split("\n");
  const y = b.split("\n");
  const n = x.length;
  const m = y.length;
  // lcs[i][j]: largo de la subsecuencia común de x[i..] y y[j..].
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      out.push({ kind: "same", text: x[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: "removed", text: x[i++] });
    } else {
      out.push({ kind: "added", text: y[j++] });
    }
  }
  while (i < n) out.push({ kind: "removed", text: x[i++] });
  while (j < m) out.push({ kind: "added", text: y[j++] });
  return out;
}

export type DiffHunk = { lines: DiffLine[]; skippedBefore: number };

/** Solo los cambios con `context` líneas iguales alrededor; el resto se resume como líneas omitidas. */
export function diffHunks(lines: DiffLine[], context = 2): DiffHunk[] {
  const keep = lines.map(() => false);
  lines.forEach((l, i) => {
    if (l.kind === "same") return;
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = true;
  });
  const hunks: DiffHunk[] = [];
  let skipped = 0;
  let current: DiffHunk | null = null;
  lines.forEach((l, i) => {
    if (!keep[i]) {
      skipped++;
      current = null;
      return;
    }
    if (!current) {
      current = { lines: [], skippedBefore: skipped };
      hunks.push(current);
      skipped = 0;
    }
    current.lines.push(l);
  });
  return hunks;
}
