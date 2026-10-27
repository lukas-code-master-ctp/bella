import { NextResponse, type NextRequest } from "next/server";
import { credential } from "@/lib/credentials";
import { afterInCompany } from "@/lib/company-request";
import { answerLeadWhenQuiet } from "@/lib/ai/respond";
import { validSignature, type WaWebhook } from "@/lib/channels/whatsapp";
import { platformApp } from "@/lib/domain/whatsapp-signup";
import { logWhatsAppWebhook, logWhatsAppWebhookError, receiveWhatsApp } from "@/lib/domain/channels";
import { receiveWhatsAppCalls } from "@/lib/domain/calls";

/** Meta verifica el webhook una vez, al registrarlo: hay que devolver el challenge. */
export async function verifyWebhook(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const token = await credential("META_VERIFY_TOKEN");
  if (params.get("hub.mode") === "subscribe" && token && params.get("hub.verify_token") === token) {
    return new NextResponse(params.get("hub.challenge") ?? "", { status: 200 });
  }
  return NextResponse.json({ error: "Token de verificación inválido" }, { status: 403 });
}

/**
 * Mensajes, estados de entrega y llamadas de WhatsApp. Se guarda todo antes de contestar 200 (Meta
 * reintenta si no) y la IA responde después, sin hacer esperar a Meta.
 */
export async function receiveWebhook(request: NextRequest) {
  const raw = await request.text();
  // La firma es de la app de la empresa o, si conectó con "Conectar con Meta", de la app de la plataforma.
  const signature = request.headers.get("x-hub-signature-256");
  const secrets = [await credential("META_APP_SECRET"), platformApp()?.secret];
  if (!secrets.some((secret) => validSignature(raw, signature, secret))) {
    // Solo si dice venir de Meta: así un error en la clave secreta de la app queda a la vista en Canales.
    if (signature) await logWhatsAppWebhook(null).catch(() => null);
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }
  let payload: WaWebhook;
  try {
    payload = JSON.parse(raw) as WaWebhook;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  await logWhatsAppWebhook(payload).catch((err) => console.error("[whatsapp] registro del webhook:", err));
  let leads: string[];
  try {
    // Primero las llamadas: Meta da menos de un minuto para contestarlas.
    await receiveWhatsAppCalls(payload);
    leads = await receiveWhatsApp(payload);
  } catch (err) {
    await logWhatsAppWebhookError(err).catch(() => null);
    throw err;
  }
  if (leads.length) await afterInCompany(() => Promise.all(leads.map((id) => answerLeadWhenQuiet(id))));
  return NextResponse.json({ ok: true });
}
