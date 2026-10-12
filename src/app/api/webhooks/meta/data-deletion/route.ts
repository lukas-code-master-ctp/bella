import { defaultCompanyRoute } from "@/lib/company-request";
import { requestDataDeletion } from "@/lib/webhooks/data-deletion";

export const dynamic = "force-dynamic";

export const POST = defaultCompanyRoute(requestDataDeletion);
