import { cronRoute } from "@/lib/cron";
import { deliverPendingWebhooks } from "@/lib/domain/webhooks";

export const dynamic = "force-dynamic";

/** Reintenta los webhooks que no salieron. */
export const GET = cronRoute(deliverPendingWebhooks);
