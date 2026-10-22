import { cronRoute } from "@/lib/cron";
import { notifyLateWaits, reassignLateWaits } from "@/lib/domain/sla";

export const dynamic = "force-dynamic";

/**
 * Avisa los leads que pasaron la meta de tiempo de respuesta y, si está activada, los reasigna
 * (ver Configuración → Tiempos de respuesta).
 */
export const GET = cronRoute(async () => ({ ...(await notifyLateWaits()), ...(await reassignLateWaits()) }));
