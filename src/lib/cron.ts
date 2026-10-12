import { NextResponse, type NextRequest } from "next/server";
import { rootDb } from "./db";
import { withCompany } from "./tenant";

/**
 * Ruta de Vercel Cron (llama con `Authorization: Bearer $CRON_SECRET`) que corre `job` una vez
 * por empresa, cada una con sus datos y credenciales. Si una empresa falla, las demás siguen y
 * la respuesta queda en 500 para que el error se vea en Vercel.
 */
export function cronRoute(job: () => Promise<object>) {
  return async (request: NextRequest) => {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const companies = await rootDb.company.findMany({ select: { id: true }, orderBy: { createdAt: "asc" } });
    const results: Record<string, object> = {};
    let failed = false;
    for (const { id } of companies) {
      try {
        results[id] = await withCompany(id, job);
      } catch (err) {
        failed = true;
        console.error(`[cron] empresa ${id}:`, err);
        results[id] = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
    return NextResponse.json({ ok: !failed, companies: results }, { status: failed ? 500 : 200 });
  };
}
