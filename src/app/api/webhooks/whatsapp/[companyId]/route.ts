import { companyRoute } from "@/lib/company-request";
import { receiveWebhook, verifyWebhook } from "@/lib/webhooks/whatsapp";

export const dynamic = "force-dynamic";
// La respuesta de la IA corre después de contestarle a Meta y puede tomar varios pasos.
export const maxDuration = 300;

export const GET = companyRoute(verifyWebhook);
export const POST = companyRoute(receiveWebhook);
