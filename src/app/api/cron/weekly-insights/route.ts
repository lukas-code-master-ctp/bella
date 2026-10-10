import { NextResponse, type NextRequest } from "next/server";
import { runWeeklyInsight } from "@/lib/ai/weekly-insights";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Lunes 9:00 (Chile): resumen de la semana pasada. Vercel Cron manda `Authorization: Bearer $CRON_SECRET`. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, ...(await runWeeklyInsight()) });
}
