import { cronRoute } from "@/lib/cron";
import { deliverPendingConversions } from "@/lib/domain/conversions";

export const dynamic = "force-dynamic";

/** Reintenta los eventos de la API de Conversiones que no salieron. */
export const GET = cronRoute(deliverPendingConversions);
