import { NextResponse, type NextRequest } from "next/server";
import { afterInCompany, publicCompanyId } from "@/lib/company-request";
import { withCompany } from "@/lib/tenant";
import { answerLeadWhenQuiet } from "@/lib/ai/respond";
import { receiveWeb } from "@/lib/domain/channels";
import { DomainError } from "@/lib/domain/leads";
import { companyActive } from "@/lib/domain/companies";
import { getWebWidgetSettings, originAllowed, publicWidgetConfig, validVisitorId, webConversation } from "@/lib/domain/web-widget";

export const dynamic = "force-dynamic";
// La respuesta de la IA corre después de contestarle al widget y puede tomar varios pasos.
export const maxDuration = 300;

type Params = { params: Promise<{ companyId: string }> };

/**
 * API pública del widget web (public/widget.js), que corre en el sitio de la empresa: responde
 * solo a los dominios permitidos y solo si el widget está activo.
 */
function cors(origin: string | null, res: NextResponse) {
  if (origin) res.headers.set("Access-Control-Allow-Origin", origin);
  res.headers.set("Vary", "Origin");
  res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  res.headers.set("Cache-Control", "no-store");
  return res;
}

async function inWidget(request: NextRequest, { params }: Params, fn: () => Promise<NextResponse>) {
  const origin = request.headers.get("origin");
  const companyId = await publicCompanyId((await params).companyId);
  if (!companyId) return cors(origin, NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 }));
  // Empresa suspendida: el chat queda como apagado.
  if (!(await companyActive(companyId))) return cors(origin, NextResponse.json({ error: "El chat no está activo" }, { status: 404 }));
  return withCompany(companyId, async () => {
    const s = await getWebWidgetSettings();
    if (!s.enabled) return cors(origin, NextResponse.json({ error: "El chat no está activo" }, { status: 404 }));
    // El propio Beliapp (página de prueba del widget) siempre puede.
    const own = Boolean(origin) && URL.canParse(origin!) && new URL(origin!).host === request.headers.get("host");
    if (!own && !originAllowed(s, origin)) return cors(null, NextResponse.json({ error: "Sitio no permitido" }, { status: 403 }));
    return cors(origin, await fn());
  });
}

export function OPTIONS(request: NextRequest) {
  return cors(request.headers.get("origin"), new NextResponse(null, { status: 204 }));
}

/** Configuración del widget y, si el visitante ya escribió, su conversación (desde `after`). */
export function GET(request: NextRequest, ctx: Params) {
  return inWidget(request, ctx, async () => {
    const q = request.nextUrl.searchParams;
    const visitor = q.get("visitor");
    const after = q.get("after") ? new Date(q.get("after")!) : undefined;
    const messages = validVisitorId(visitor) ? await webConversation(visitor, after && !isNaN(+after) ? after : undefined) : [];
    return NextResponse.json({ config: await publicWidgetConfig(), messages });
  });
}

/** Mensaje del visitante. La IA responde después, si está encendida para el widget. */
export function POST(request: NextRequest, ctx: Params) {
  return inWidget(request, ctx, async () => {
    const data = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const text = (k: string) => (typeof data?.[k] === "string" ? (data[k] as string) : undefined);
    if (!validVisitorId(data?.visitorId) || !text("clientId") || !text("body")) {
      return NextResponse.json({ error: "Mensaje inválido" }, { status: 400 });
    }
    try {
      const res = await receiveWeb({
        visitorId: data.visitorId,
        clientId: text("clientId")!,
        body: text("body")!,
        name: text("name"),
        phone: text("phone"),
        email: text("email"),
        pageUrl: text("pageUrl"),
      });
      if (res?.answer) await afterInCompany(() => answerLeadWhenQuiet(res.leadId));
      return NextResponse.json({ ok: true });
    } catch (e) {
      if (e instanceof DomainError) return NextResponse.json({ error: e.message }, { status: 429 });
      throw e;
    }
  });
}
