import type { Prisma, PrismaClient } from "@prisma/client";
import { currentCompanyId, DEFAULT_COMPANY_ID } from "../tenant";

/**
 * Embudo principal de la empresa por defecto: lo creó la migración de embudos con las etapas que
 * ya existían, y es el valor por defecto de la columna Stage.funnelId (código anterior).
 */
export const DEFAULT_FUNNEL_ID = "default";

/** Id del embudo principal de una empresa (el primero, que no se puede borrar). */
export function primaryFunnelIdFor(companyId: string) {
  return companyId === DEFAULT_COMPANY_ID ? DEFAULT_FUNNEL_ID : `principal-${companyId}`;
}

export async function primaryFunnelId() {
  return primaryFunnelIdFor(await currentCompanyId());
}

/** Garantiza que exista el embudo principal de la empresa (una empresa nueva parte sin él). */
export async function ensureDefaultFunnel(client: Prisma.TransactionClient | PrismaClient) {
  const id = await primaryFunnelId();
  return client.funnel.upsert({
    where: { id },
    create: { id, name: "Principal", position: 0 },
    update: {},
  });
}
