import Papa from "papaparse";
import { db } from "./db";
import { getSetting, setSetting } from "./settings";
import { normalize, score, tokens } from "./text";

export type InventorySettings = { sheetUrl: string; lastSyncAt?: string; lastSyncRows?: number };

/**
 * Convierte el enlace de una planilla de Google Sheets en su URL de exportación CSV.
 * La planilla debe estar compartida como "Cualquier persona con el enlace puede ver".
 * También acepta un enlace CSV directo.
 */
export function toCsvExportUrl(url: string): string {
  const match = url.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) return url;
  const gid = url.match(/[#&?]gid=(\d+)/)?.[1] ?? "0";
  return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${gid}`;
}

export function parseInventoryCsv(csv: string) {
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  return parsed.data
    .map((row) =>
      Object.fromEntries(
        Object.entries(row)
          .filter(([k]) => k !== "")
          .map(([k, v]) => [k, (v ?? "").trim()]),
      ),
    )
    .filter((row) => Object.values(row).some((v) => v !== ""));
}

export async function syncInventory(fetchImpl: typeof fetch = fetch) {
  const settings = await getSetting<InventorySettings>("inventory", { sheetUrl: "" });
  if (!settings.sheetUrl) throw new Error("Configura primero el enlace de la planilla.");
  const response = await fetchImpl(toCsvExportUrl(settings.sheetUrl), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(
      `No se pudo leer la planilla (HTTP ${response.status}). Revisa que esté compartida con "cualquier persona con el enlace".`,
    );
  }
  const text = await response.text();
  if (text.trimStart().startsWith("<")) {
    throw new Error("La planilla no es pública: Google devolvió una página de inicio de sesión.");
  }
  const rows = parseInventoryCsv(text);
  const syncedAt = new Date();
  await db.$transaction([
    db.inventoryItem.deleteMany(),
    db.inventoryItem.createMany({
      data: rows.map((row, i) => ({
        rowNumber: i + 2,
        data: row,
        searchText: normalize(Object.values(row).join(" ")),
        syncedAt,
      })),
    }),
  ]);
  await setSetting<InventorySettings>("inventory", {
    ...settings,
    lastSyncAt: syncedAt.toISOString(),
    lastSyncRows: rows.length,
  });
  return rows.length;
}

/** Busca filas del inventario que coincidan con la consulta. */
export async function searchInventory(query: string, limit = 20) {
  const items = await db.inventoryItem.findMany({ orderBy: { rowNumber: "asc" } });
  const q = tokens(query);
  if (q.length === 0) return items.slice(0, limit).map((i) => i.data);
  return items
    .map((i) => ({ item: i, score: score(q, i.searchText) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.item.rowNumber - b.item.rowNumber)
    .slice(0, limit)
    .map((r) => r.item.data);
}
