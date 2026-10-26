import { NextResponse, type NextRequest } from "next/server";
import { emailWebhookSecret } from "@/lib/domain/email-domains";
import { handleResendEvent, verifyResendSignature } from "@/lib/domain/email-suppression";
import { withCompany } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/**
 * Avisos de Resend de los envíos por correo de una empresa (entregado, abierto, clic, rebote,
 * queja). Beliapp crea este webhook en la cuenta de Resend de la empresa al conectar su dominio,
 * y cada empresa firma con su propio secreto.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const raw = await request.text();
  const secret = await withCompany(companyId, () => emailWebhookSecret());
  const ok = verifyResendSignature(
    raw,
    {
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
    },
    secret,
  );
  if (!ok) return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  let event: Parameters<typeof handleResendEvent>[0];
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const suppressed = await handleResendEvent(event, companyId);
  return NextResponse.json({ ok: true, suppressed });
}
