import { db } from "../db";
import { localMonthName, startOfLocalMonth } from "../dates";

const DAY_MS = 86_400_000;

/** Guarda el gasto de una llamada a la IA. Nunca falla: el registro no debe cortar una respuesta. */
export async function recordAiUsage(entry: { model: string; inputTokens?: number; outputTokens?: number; cost: number }) {
  try {
    await db.aiUsage.create({ data: entry });
  } catch (err) {
    console.error("[ai-usage] no se pudo registrar:", err);
  }
}

export type SpendRow = {
  label: string;
  /** Dólares gastados en el período. */
  cost: number;
  /** Variación (%) contra el período equivalente anterior; null si ese período no tuvo gasto. */
  change: number | null;
};

async function spent(from: Date, to: Date) {
  const { _sum } = await db.aiUsage.aggregate({ _sum: { cost: true }, where: { createdAt: { gte: from, lt: to } } });
  return _sum.cost ?? 0;
}

const change = (cost: number, before: number) => (before > 0 ? ((cost - before) / before) * 100 : null);

/**
 * Consumo de IA para Configuración: últimos 7 días, mes en curso y los 3 meses anteriores. Cada
 * fila se compara con el período equivalente anterior (los 7 días previos, el mismo tramo del mes
 * pasado, o el mes anterior). Null si todavía no hay registros.
 */
export async function aiSpendSummary(now = new Date()): Promise<SpendRow[] | null> {
  try {
    return await summarize(now);
  } catch (err) {
    // Ej. un preview que usa la base de producción antes de que exista la tabla.
    console.error("[ai-usage] no se pudo leer el consumo:", err);
    return null;
  }
}

async function summarize(now: Date): Promise<SpendRow[] | null> {
  if ((await db.aiUsage.count()) === 0) return null;
  const month = (n: number) => startOfLocalMonth(now, n);
  const elapsed = now.getTime() - month(0).getTime();
  const sameStretchLastMonth = new Date(Math.min(month(-1).getTime() + elapsed, month(0).getTime()));
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);

  const [week, prevWeek, current, prevStretch, m1, m2, m3, m4] = await Promise.all([
    spent(weekAgo, now),
    spent(new Date(now.getTime() - 14 * DAY_MS), weekAgo),
    spent(month(0), now),
    spent(month(-1), sameStretchLastMonth),
    spent(month(-1), month(0)),
    spent(month(-2), month(-1)),
    spent(month(-3), month(-2)),
    spent(month(-4), month(-3)),
  ]);
  return [
    { label: "Últimos 7 días", cost: week, change: change(week, prevWeek) },
    { label: `${localMonthName(now)} (en curso)`, cost: current, change: change(current, prevStretch) },
    { label: localMonthName(month(-1)), cost: m1, change: change(m1, m2) },
    { label: localMonthName(month(-2)), cost: m2, change: change(m2, m3) },
    { label: localMonthName(month(-3)), cost: m3, change: change(m3, m4) },
  ];
}
