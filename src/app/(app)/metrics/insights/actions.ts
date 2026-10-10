"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { generateWeeklyInsight } from "@/lib/ai/weekly-insights";
import { saveWeeklyEmailSettings, sendWeeklyInsightEmail } from "@/lib/domain/weekly-email";

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

export async function saveWeeklyEmailAction(form: FormData) {
  await requireAdmin();
  await saveWeeklyEmailSettings({
    enabled: form.get("enabled") === "on",
    from: String(form.get("from") ?? "").trim(),
    toAdmins: form.get("toAdmins") === "on",
    extra: String(form.get("extra") ?? ""),
  });
  revalidatePath("/metrics/insights");
}

/** Manda ahora por correo el resumen que se está viendo (sirve para probar la configuración). */
export async function sendWeeklyEmailNowAction(insightId: string) {
  await requireAdmin();
  await sendWeeklyInsightEmail(insightId, { force: true });
  revalidatePath("/metrics/insights");
}
