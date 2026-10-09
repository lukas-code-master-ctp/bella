import { NextResponse, type NextRequest } from "next/server";
import { runDueFollowUps } from "@/lib/ai/follow-ups";

export const dynamic = "force-dynamic";
// Cada seguimiento es una llamada a la IA.
export const maxDuration = 300;

/** Vercel Cron llama esta ruta con `Authorization: Bearer $CRON_SECRET`. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, ...(await runDueFollowUps()) });
}
