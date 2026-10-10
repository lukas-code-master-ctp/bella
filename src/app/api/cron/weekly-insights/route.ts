import { NextResponse, type NextRequest } from "next/server";
import { runWeeklyInsight } from "@/lib/ai/weekly-insights";
import { sendWeeklyInsightEmail } from "@/lib/domain/weekly-email";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Lunes 9:00 (Chile): resumen de la semana pasada, y por correo si está encendido.
 * Vercel Cron manda `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const result = await runWeeklyInsight();
  const email = result.insightId ? await sendWeeklyInsightEmail(result.insightId) : null;
  return NextResponse.json({ ok: true, ...result, email });
}
