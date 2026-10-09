import { NextResponse, type NextRequest } from "next/server";
import { syncInventory } from "@/lib/inventory";

export const dynamic = "force-dynamic";

/** Vercel Cron llama esta ruta con `Authorization: Bearer $CRON_SECRET`. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  try {
    const rows = await syncInventory();
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    const error = e instanceof Error ? e.message : "No se pudo sincronizar.";
    // Sin planilla configurada no es una falla del cron.
    const status = error.startsWith("Configura primero") ? 200 : 500;
    return NextResponse.json({ ok: false, error }, { status });
  }
}
