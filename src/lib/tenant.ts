import { AsyncLocalStorage } from "node:async_hooks";
import { readSession, SESSION_COOKIE } from "./session-token";

/**
 * Beliapp atiende a varias empresas con una sola base: cada dato lleva su companyId y `db`
 * (db.ts) filtra y completa ese campo solo. La empresa de cada consulta sale, en orden, de:
 * 1. `withCompany(id, fn)`: webhooks, cron y pruebas, que no tienen sesión.
 * 2. La sesión del usuario (el token lleva su empresa).
 * 3. DEFAULT_COMPANY_ID, la empresa de las instalaciones anteriores.
 */
export const DEFAULT_COMPANY_ID = "default";

let fallbackCompanyId = DEFAULT_COMPANY_ID;

/** Solo pruebas: corren como otra empresa para detectar datos que caen en la por defecto. */
export function setFallbackCompanyId(id: string) {
  fallbackCompanyId = id;
}

const store = new AsyncLocalStorage<string>();

/**
 * Corre `fn` con todas sus consultas en la empresa `companyId`. Se espera adentro porque las
 * consultas de Prisma recién se ejecutan al esperarlas: devolver `db.x.findMany()` sin esperar
 * la correría fuera de la empresa.
 */
export function withCompany<T>(companyId: string, fn: () => T | Promise<T>): Promise<T> {
  return store.run(companyId, async () => await fn());
}

async function sessionCompanyId(): Promise<string | null> {
  const { cookies } = await import("next/headers");
  let token: string | undefined;
  try {
    token = (await cookies()).get(SESSION_COOKIE)?.value;
  } catch (e) {
    // Next usa errores para marcar una página como dinámica: esos deben seguir su camino.
    const { unstable_rethrow } = await import("next/navigation");
    unstable_rethrow(e);
    // Fuera de una solicitud (scripts, pruebas) no hay cookies.
    return null;
  }
  return (await readSession(token))?.companyId ?? null;
}

export async function currentCompanyId(): Promise<string> {
  return store.getStore() ?? (await sessionCompanyId()) ?? fallbackCompanyId;
}
