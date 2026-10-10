import { NextResponse, type NextRequest } from "next/server";
import { answerWaitingLeads } from "@/lib/ai/respond";

export const dynamic = "force-dynamic";
// Cada respuesta es una llamada a la IA.
export const maxDuration = 300;

/**
 * Responde lo que los clientes escribieron fuera del horario de atención o con la IA apagada.
 * Vercel Cron llama esta ruta con `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, answered: await answerWaitingLeads() });
}
