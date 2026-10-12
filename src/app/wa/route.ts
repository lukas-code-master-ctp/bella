import { NextResponse, type NextRequest } from "next/server";
import { publicCompanyId } from "@/lib/company-request";
import { withCompany } from "@/lib/tenant";
import { createSourceLink, getAttributionSettings, utmFromParams, whatsappUrl } from "@/lib/domain/attribution";

export const dynamic = "force-dynamic";

/**
 * Botón de WhatsApp de una landing: /wa?utm_source=…&utm_campaign=…&text=Hola. Guarda los UTM y
 * redirige a WhatsApp con un código al final del mensaje prellenado; cuando el mensaje llega,
 * el lead queda con ese origen. Las empresas que no son la por defecto agregan `c=<empresa>`.
 */
export async function GET(request: NextRequest) {
  const companyId = await publicCompanyId(request.nextUrl.searchParams.get("c"));
  if (!companyId) return new NextResponse("Enlace inválido.", { status: 404 });
  return withCompany(companyId, () => redirectToWhatsApp(request));
}

async function redirectToWhatsApp(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const settings = await getAttributionSettings();
  const number = settings.whatsappNumber;
  if (!number) {
    return new NextResponse("Falta configurar el número de WhatsApp en Configuración → Origen de leads.", { status: 404 });
  }
  const code = await createSourceLink({ ...utmFromParams(params), landingUrl: request.headers.get("referer") });
  const text = params.get("text")?.trim().slice(0, 500) || settings.defaultText;
  return NextResponse.redirect(whatsappUrl(number, text, code), 302);
}
