import { after, NextResponse, type NextRequest } from "next/server";
import { answerLeadWhenQuiet } from "@/lib/ai/respond";
import type { MessengerWebhook } from "@/lib/channels/messenger";
import { validSignature } from "@/lib/channels/whatsapp";
import { receiveMessenger } from "@/lib/domain/channels";
import { receiveComments } from "@/lib/domain/comments";

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

/** Mensajes directos y comentarios de Instagram (object "instagram") y de la página (object "page"). */
export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!validSignature(raw, request.headers.get("x-hub-signature-256"), process.env.META_APP_SECRET)) {
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }
  let payload: MessengerWebhook;
  try {
    payload = JSON.parse(raw) as MessengerWebhook;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  await receiveComments(payload);
  const leads = await receiveMessenger(payload);
  if (leads.length) after(() => Promise.all(leads.map((id) => answerLeadWhenQuiet(id))));
  return NextResponse.json({ ok: true });
}
