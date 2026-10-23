import { NextResponse, type NextRequest } from "next/server";
import { handleResendEvent, verifyResendSignature } from "@/lib/domain/email-suppression";

export const dynamic = "force-dynamic";

/**
 * Avisos de Resend (rebotes y quejas de spam) de los envíos por correo de todas las empresas:
 * la empresa sale del dominio del remitente. Se configura una vez en Resend → Webhooks con los
 * eventos email.bounced y email.complained, y su secreto va en RESEND_WEBHOOK_SECRET.
 */
export async function POST(request: NextRequest) {
  const raw = await request.text();
  const ok = verifyResendSignature(
    raw,
    {
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
    },
    process.env.RESEND_WEBHOOK_SECRET,
  );
  if (!ok) return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  let event: Parameters<typeof handleResendEvent>[0];
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const suppressed = await handleResendEvent(event);
  return NextResponse.json({ ok: true, suppressed });
}
