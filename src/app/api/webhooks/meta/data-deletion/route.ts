import { defaultCompanyRoute } from "@/lib/company-request";
import { requestDataDeletion } from "@/lib/webhooks/data-deletion";

export const dynamic = "force-dynamic";

// Una empresa suspendida igual debe cumplir las solicitudes de eliminación de datos.
export const POST = defaultCompanyRoute(requestDataDeletion, { evenSuspended: true });
