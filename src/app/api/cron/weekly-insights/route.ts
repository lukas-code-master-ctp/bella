import { cronRoute } from "@/lib/cron";
import { runWeeklyInsight } from "@/lib/ai/weekly-insights";
import { sendWeeklyInsightEmail } from "@/lib/domain/weekly-email";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Lunes desde las 9:00 (Chile): resumen de la semana pasada, y por correo si está encendido. Corre
 * cada hora hasta las 14:00: las empresas que no alcanzaron en los 300 s de una pasada (cada
 * resumen es una llamada a la IA) se hacen en la siguiente, y las que ya lo tienen se saltan.
 */
export const GET = cronRoute(async () => {
  const result = await runWeeklyInsight();
  const email = result.insightId ? await sendWeeklyInsightEmail(result.insightId) : null;
  return { ...result, email };
});
