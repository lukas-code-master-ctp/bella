import Papa from "papaparse";
import { db } from "./db";
import { getSetting, setSetting } from "./settings";
import { normalize, score, tokens } from "./text";

export type InventorySettings = {
  sheetUrl: string;
  lastSyncAt?: string;
  lastSyncRows?: number;
  /** Último intento (exitoso o no), para no reintentar en cada turno si la planilla falla. */
  lastAttemptAt?: string;
  lastError?: string;
};

/** Antigüedad máxima del inventario antes de que la asistente lo vuelva a leer de la planilla. */
export const INVENTORY_MAX_AGE_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20_000;
/** Clave del advisory lock de Postgres que serializa las sincronizaciones. */
const SYNC_LOCK_KEY = 728_001;

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
  const attemptAt = new Date().toISOString();
  try {
    const rows = await fetchSheetRows(settings.sheetUrl, fetchImpl);
    const syncedAt = new Date();
    await db.$transaction(async (tx) => {
      // Dos sincronizaciones simultáneas (cron y asistente) duplicarían filas sin este lock.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SYNC_LOCK_KEY})`;
      await tx.inventoryItem.deleteMany();
      await tx.inventoryItem.createMany({
        data: rows.map((row, i) => ({
          rowNumber: i + 2,
          data: row,
          searchText: normalize(Object.values(row).join(" ")),
          syncedAt,
        })),
      });
    });
    await saveSyncState({
      lastSyncAt: syncedAt.toISOString(),
      lastSyncRows: rows.length,
      lastAttemptAt: attemptAt,
      lastError: undefined,
    });
    return rows.length;
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo sincronizar.";
    await saveSyncState({ lastAttemptAt: attemptAt, lastError: message });
    throw e;
  }
}

async function fetchSheetRows(sheetUrl: string, fetchImpl: typeof fetch) {
  const response = await fetchImpl(toCsvExportUrl(sheetUrl), {
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(
      `No se pudo leer la planilla (HTTP ${response.status}). Revisa que esté compartida con "cualquier persona con el enlace".`,
    );
  }
  const text = await response.text();
  if (text.trimStart().startsWith("<")) {
    throw new Error("La planilla no es pública: Google devolvió una página de inicio de sesión.");
  }
  return parseInventoryCsv(text);
}

/** Relee la configuración antes de guardar para no pisar un cambio de enlace hecho mientras tanto. */
async function saveSyncState(state: Partial<InventorySettings>) {
  const current = await getSetting<InventorySettings>("inventory", { sheetUrl: "" });
  await setSetting<InventorySettings>("inventory", { ...current, ...state });
}

/**
 * Sincroniza si el último intento tiene más de `INVENTORY_MAX_AGE_MS`. Nunca lanza: si la planilla
 * falla, se sigue usando el inventario guardado y el error queda visible en Configuración.
 */
export async function syncInventoryIfStale(fetchImpl: typeof fetch = fetch, now = new Date()) {
  const settings = await getSetting<InventorySettings>("inventory", { sheetUrl: "" });
  if (!settings.sheetUrl) return false;
  const last = settings.lastAttemptAt ?? settings.lastSyncAt;
  if (last && now.getTime() - new Date(last).getTime() < INVENTORY_MAX_AGE_MS) return false;
  try {
    await syncInventory(fetchImpl);
    return true;
  } catch (e) {
    console.error("[inventory] sincronización automática falló", e);
    return false;
  }
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
