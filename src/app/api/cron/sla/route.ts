import { cronRoute } from "@/lib/cron";
import { notifyLateWaits } from "@/lib/domain/sla";

export const dynamic = "force-dynamic";

/** Avisa los leads que pasaron la meta de tiempo de respuesta (ver SLA en Configuración). */
export const GET = cronRoute(async () => notifyLateWaits());
