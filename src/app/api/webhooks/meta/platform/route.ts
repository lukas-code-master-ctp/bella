import { receivePlatformWebhook, verifyPlatformWebhook } from "@/lib/webhooks/meta";

export const dynamic = "force-dynamic";
// La respuesta de la IA corre después de contestarle a Meta y puede tomar varios pasos.
export const maxDuration = 300;

// Webhook de la app de Beliapp en Meta: páginas e Instagram conectados con "Conectar con Meta".
export const GET = verifyPlatformWebhook;
export const POST = receivePlatformWebhook;
