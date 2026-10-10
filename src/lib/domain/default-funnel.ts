import type { Prisma, PrismaClient } from "@prisma/client";

/** Embudo que crea la migración con las etapas que ya existían; también es el valor por defecto de Stage.funnelId. */
export const DEFAULT_FUNNEL_ID = "default";

/** Garantiza que exista el embudo por defecto (la migración lo crea; una base vacía puede no tenerlo). */
export async function ensureDefaultFunnel(client: Prisma.TransactionClient | PrismaClient) {
  return client.funnel.upsert({
    where: { id: DEFAULT_FUNNEL_ID },
    create: { id: DEFAULT_FUNNEL_ID, name: "Principal", position: 0 },
    update: {},
  });
}
