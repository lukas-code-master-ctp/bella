import { defaultCompanyRoute } from "@/lib/company-request";
import { receiveWebhook, verifyWebhook } from "@/lib/webhooks/whatsapp";

export const dynamic = "force-dynamic";
// La respuesta de la IA corre después de contestarle a Meta y puede tomar varios pasos.
export const maxDuration = 300;

// URL de antes, sin empresa: es la de la empresa por defecto. Las demás usan ./[companyId].
export const GET = defaultCompanyRoute(verifyWebhook);
export const POST = defaultCompanyRoute(receiveWebhook);
