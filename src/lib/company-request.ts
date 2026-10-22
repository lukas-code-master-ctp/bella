import { after, NextResponse, type NextRequest } from "next/server";
import { rootDb } from "./db";
import { companyActive } from "./domain/companies";
import { currentCompanyId, DEFAULT_COMPANY_ID, withCompany } from "./tenant";

/**
 * Empresa de una dirección pública (webhook, página legal o enlace /wa), que no tiene sesión:
 * viene en la URL. Sin id es la empresa por defecto, así las URLs de antes siguen igual. Null
 * si la empresa no existe o fue eliminada.
 */
export async function publicCompanyId(id: string | null | undefined): Promise<string | null> {
  if (!id || id === DEFAULT_COMPANY_ID) return DEFAULT_COMPANY_ID;
  const company = await rootDb.company.findUnique({ where: { id }, select: { id: true, deletedAt: true } });
  return company && !company.deletedAt ? company.id : null;
}

/** Corre `fn` en la empresa de `?c=` (páginas públicas y /wa). */
export async function withPublicCompany<T>(id: string | null | undefined, fn: () => Promise<T>): Promise<T | null> {
  const companyId = await publicCompanyId(id);
  return companyId ? withCompany(companyId, fn) : null;
}

type Handler = (request: NextRequest) => Promise<Response>;

/**
 * Corre el webhook en la empresa. Si está suspendida, los avisos (POST) se reciben con 200 para
 * que Meta no los reintente, pero no crean leads, mensajes ni respuestas de la IA. La
 * verificación (GET) sigue funcionando, así la conexión con Meta no se rompe mientras tanto.
 */
async function runWebhook(companyId: string, request: NextRequest, handler: Handler, evenSuspended: boolean) {
  if (!evenSuspended && request.method !== "GET" && !(await companyActive(companyId))) {
    return NextResponse.json({ ok: true, ignored: "empresa suspendida" });
  }
  return withCompany(companyId, () => handler(request));
}

/**
 * Ruta de webhook de una empresa: /api/webhooks/<canal>/<empresa>. `evenSuspended`: atiende
 * igual a una empresa suspendida (solicitudes de eliminación de datos, que hay que cumplir).
 */
export function companyRoute(handler: Handler, { evenSuspended = false } = {}) {
  return async (request: NextRequest, { params }: { params: Promise<{ companyId: string }> }) => {
    const companyId = await publicCompanyId((await params).companyId);
    if (!companyId) return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
    return runWebhook(companyId, request, handler, evenSuspended);
  };
}

/** Ruta de webhook de antes, sin empresa en la URL: atiende a la empresa por defecto. */
export function defaultCompanyRoute(handler: Handler, { evenSuspended = false } = {}) {
  return (request: NextRequest) => runWebhook(DEFAULT_COMPANY_ID, request, handler, evenSuspended);
}

/**
 * `after()` en la empresa en curso. Lo que corre después de responder ya no tiene la cookie
 * de sesión ni el contexto de `withCompany`, así que la empresa se toma antes.
 */
export async function afterInCompany(fn: () => unknown) {
  const companyId = await currentCompanyId();
  after(() => withCompany(companyId, async () => await fn()));
}
