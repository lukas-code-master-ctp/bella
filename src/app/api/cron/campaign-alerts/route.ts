import { cronRoute } from "@/lib/cron";
import { runCampaignAlerts } from "@/lib/domain/campaign-alerts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Dos veces al día (9:00 y 17:00 de Chile): revisa qué campañas pierden casi todos sus leads. */
export const GET = cronRoute(() => runCampaignAlerts());
