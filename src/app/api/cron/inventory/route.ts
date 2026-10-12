import { cronRoute } from "@/lib/cron";
import { syncInventory } from "@/lib/inventory";

export const dynamic = "force-dynamic";

export const GET = cronRoute(async () => {
  try {
    return { ok: true, rows: await syncInventory() };
  } catch (e) {
    const error = e instanceof Error ? e.message : "No se pudo sincronizar.";
    // Sin planilla configurada no es una falla del cron.
    if (error.startsWith("Configura primero")) return { ok: false, error };
    throw e;
  }
});
