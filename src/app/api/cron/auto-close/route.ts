import { NextResponse, type NextRequest } from "next/server";
import { runAutoClose } from "@/lib/domain/auto-close";

export const dynamic = "force-dynamic";

/** Vercel Cron llama esta ruta con `Authorization: Bearer $CRON_SECRET`. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const closed = await runAutoClose();
  return NextResponse.json({ ok: true, closed });
}
