import { after, NextResponse, type NextRequest } from "next/server";
import { answerLead } from "@/lib/ai/respond";
import { validSignature, type WaWebhook } from "@/lib/channels/whatsapp";
import { logWhatsAppWebhook, logWhatsAppWebhookError, receiveWhatsApp } from "@/lib/domain/channels";

export const dynamic = "force-dynamic";
// La respuesta de la IA corre después de contestarle a Meta y puede tomar varios pasos.
export const maxDuration = 300;

/** Meta verifica el webhook una vez, al registrarlo: hay que devolver el challenge. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const token = process.env.META_VERIFY_TOKEN;
  if (params.get("hub.mode") === "subscribe" && token && params.get("hub.verify_token") === token) {
    return new NextResponse(params.get("hub.challenge") ?? "", { status: 200 });
  }
  return NextResponse.json({ error: "Token de verificación inválido" }, { status: 403 });
}

/**
 * Mensajes y estados de entrega de WhatsApp. Se guarda todo antes de contestar 200 (Meta
 * reintenta si no) y la IA responde después, sin hacer esperar a Meta.
 */
export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!validSignature(raw, request.headers.get("x-hub-signature-256"), process.env.META_APP_SECRET)) {
    // Solo si dice venir de Meta: así un error en META_APP_SECRET queda a la vista en Canales.
    if (request.headers.get("x-hub-signature-256")) await logWhatsAppWebhook(null).catch(() => null);
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
    leads = await receiveWhatsApp(payload);
  } catch (err) {
    await logWhatsAppWebhookError(err).catch(() => null);
    throw err;
  }
  if (leads.length) after(() => Promise.all(leads.map((id) => answerLead(id))));
  return NextResponse.json({ ok: true });
}
