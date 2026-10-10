import type { AssistantVariant, Channel, Prisma } from "@prisma/client";
import { db } from "../db";
import type { AssistantSettings } from "../settings";
import { DomainError } from "./leads";

/**
 * Pruebas A/B de la asistente por canal. Mientras un canal tenga variantes activas, cada lead
 * nuevo de ese canal recibe una al azar según su peso y la mantiene: así cada conversación usa
 * siempre las mismas instrucciones. Sin variantes activas no cambia nada.
 */

type Client = Prisma.TransactionClient | typeof db;

export type VariantInput = {
  name: string;
  channel: Channel;
  assistantName: string;
  instructions: string;
  weight: number;
  active: boolean;
};

export const MAX_WEIGHT = 100;

/** Variante para un lead nuevo del canal, o null si el canal no tiene una prueba activa. */
export async function pickVariant(client: Client, channel: Channel, random = Math.random): Promise<string | null> {
  const variants = await client.assistantVariant.findMany({
    where: { channel, active: true, weight: { gt: 0 } },
    orderBy: { createdAt: "asc" },
  });
  const total = variants.reduce((n, v) => n + v.weight, 0);
  if (!total) return null;
  let r = random() * total;
  for (const v of variants) {
    r -= v.weight;
    if (r < 0) return v.id;
  }
  return variants[variants.length - 1].id;
}

/** La asistente con lo propio de la variante: su nombre y sus instrucciones adicionales. */
export function applyVariant(
  settings: AssistantSettings,
  variant: Pick<AssistantVariant, "assistantName" | "instructions"> | null,
): AssistantSettings {
  if (!variant) return settings;
  const extra = variant.instructions.trim();
  return {
    ...settings,
    assistantName: variant.assistantName?.trim() || settings.assistantName,
    instructions: extra ? `${settings.instructions}\n\nAdemás:\n${extra}` : settings.instructions,
  };
}

function clean(input: VariantInput) {
  const name = input.name.trim();
  if (!name) throw new DomainError("Escribe el nombre de la variante.");
  const weight = Math.round(input.weight);
  if (!Number.isFinite(weight) || weight < 0 || weight > MAX_WEIGHT) {
    throw new DomainError(`El peso va de 0 a ${MAX_WEIGHT}.`);
  }
  return {
    name,
    channel: input.channel,
    assistantName: input.assistantName.trim() || null,
    instructions: input.instructions.trim(),
    weight,
    active: input.active,
  };
}

export async function createVariant(input: VariantInput) {
  return db.assistantVariant.create({ data: clean(input) });
}

/** El canal no se cambia: los leads que ya la recibieron son de ese canal. */
export async function updateVariant(id: string, input: Omit<VariantInput, "channel">) {
  const { channel: _channel, ...data } = clean({ ...input, channel: "SIMULATOR" });
  return db.assistantVariant.update({ where: { id }, data });
}

/** Una variante con leads no se borra (se perderían sus resultados): se pausa. */
export async function deleteVariant(id: string) {
  if (await db.lead.count({ where: { variantId: id } })) {
    throw new DomainError("La variante ya tiene leads: pausa la variante en vez de borrarla para conservar sus resultados.");
  }
  await db.assistantVariant.delete({ where: { id } });
}

export type VariantStats = AssistantVariant & {
  leads: number;
  open: number;
  won: number;
  lost: number;
  /** Ganados sobre cerrados (null sin leads cerrados). */
  winRate: number | null;
  /** Leads que llegaron a una etapa de atención humana o más allá, sobre el total. */
  handedOff: number;
};

/** Resultados de cada variante, agrupadas por canal en el orden en que se crearon. */
export async function variantStats(): Promise<VariantStats[]> {
  const [variants, byStatus, handoffs] = await Promise.all([
    db.assistantVariant.findMany({ orderBy: [{ channel: "asc" }, { createdAt: "asc" }] }),
    db.lead.groupBy({ by: ["variantId", "status"], where: { variantId: { not: null } }, _count: { _all: true } }),
    db.lead.groupBy({
      by: ["variantId"],
      where: { variantId: { not: null }, events: { some: { type: "HANDOFF" } } },
      _count: { _all: true },
    }),
  ]);
  return variants.map((v) => {
    const count = (status: string) => byStatus.find((r) => r.variantId === v.id && r.status === status)?._count._all ?? 0;
    const [open, won, lost] = [count("OPEN"), count("WON"), count("LOST")];
    return {
      ...v,
      leads: open + won + lost,
      open,
      won,
      lost,
      winRate: won + lost ? won / (won + lost) : null,
      handedOff: handoffs.find((r) => r.variantId === v.id)?._count._all ?? 0,
    };
  });
}
