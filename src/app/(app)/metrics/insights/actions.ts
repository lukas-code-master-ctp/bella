"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { generateWeeklyInsight } from "@/lib/ai/weekly-insights";

/** Genera ahora el resumen de los últimos 7 días (sin esperar al lunes). */
export async function generateInsightAction(): Promise<string | null> {
  await requireAdmin();
  const to = new Date();
  try {
    await generateWeeklyInsight({ from: new Date(to.getTime() - 7 * 86_400_000), to });
  } catch (e) {
    console.error("[insights semanales]", e);
    return "La IA no pudo generar el resumen. Revisa la configuración de la IA e inténtalo de nuevo.";
  }
  revalidatePath("/metrics/insights");
  revalidatePath("/", "layout");
  return null;
}
