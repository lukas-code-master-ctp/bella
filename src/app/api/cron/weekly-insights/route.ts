import { cronRoute } from "@/lib/cron";
import { runWeeklyInsight } from "@/lib/ai/weekly-insights";
import { sendWeeklyInsightEmail } from "@/lib/domain/weekly-email";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Lunes 9:00 (Chile): resumen de la semana pasada, y por correo si está encendido. */
export const GET = cronRoute(async () => {
  const result = await runWeeklyInsight();
  const email = result.insightId ? await sendWeeklyInsightEmail(result.insightId) : null;
  return { ...result, email };
});
