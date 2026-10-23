import { NextResponse, type NextRequest } from "next/server";
import { publicCompanyId } from "@/lib/company-request";
import { readUnsubscribeToken, suppressEmail } from "@/lib/domain/email-suppression";
import { withCompany } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/**
 * Baja en un clic (RFC 8058): el botón "Anular suscripción" de Gmail, Yahoo y otros hace un POST
 * a la dirección de la cabecera List-Unsubscribe. Funciona aunque la empresa esté suspendida.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const data = readUnsubscribeToken((await params).token);
  const companyId = data && (await publicCompanyId(data.companyId));
  if (!data || !companyId) return NextResponse.json({ error: "Enlace inválido" }, { status: 404 });
  await withCompany(companyId, () => suppressEmail(data.email, "UNSUBSCRIBED"));
  return NextResponse.json({ ok: true });
}
