import type { Channel, Funnel, Prisma, Stage } from "@prisma/client";
import { db } from "../db";
import type { AssistantSettings } from "../settings";
import { DEFAULT_FUNNEL_ID } from "./default-funnel";
import { DomainError } from "./leads";

export { DEFAULT_FUNNEL_ID, ensureDefaultFunnel } from "./default-funnel";

type Client = Prisma.TransactionClient | typeof db;

export async function listFunnels(client: Client = db) {
  return client.funnel.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
}

/**
 * Primera etapa del embudo donde entra un lead nuevo: el embudo indicado, o el que tiene asignado
 * el canal, o el primero. Se salta los embudos sin etapas.
 */
export async function entryStage(client: Client, channel: Channel, funnelId?: string | null): Promise<Stage> {
  const funnels = await client.funnel.findMany({
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    include: { stages: { orderBy: { position: "asc" }, take: 1 } },
  });
  const withStages = funnels.filter((f) => f.stages.length);
  const funnel =
    (funnelId ? withStages.find((f) => f.id === funnelId) : undefined) ??
    withStages.find((f) => f.channels.includes(channel)) ??
    withStages[0];
  if (!funnel) throw new DomainError("No hay etapas configuradas en el funnel.");
  return funnel.stages[0];
}

/** Etapas del embudo de una etapa (el embudo del lead), en orden. */
export async function funnelStages(client: Client, funnelId: string) {
  return client.stage.findMany({ where: { funnelId }, orderBy: { position: "asc" } });
}

/** La asistente de un embudo: su nombre propio y sus instrucciones se suman a las generales. */
export function assistantFor(base: AssistantSettings, funnel: Pick<Funnel, "assistantName" | "instructions"> | null): AssistantSettings {
  if (!funnel) return base;
  const extra = funnel.instructions?.trim();
  return {
    ...base,
    assistantName: funnel.assistantName?.trim() || base.assistantName,
    instructions: extra ? `${base.instructions}\n\nEn esta línea de negocio:\n${extra}` : base.instructions,
  };
}

/**
 * Todas las etapas con su nombre para mostrar en listas: si hay más de un embudo, "Embudo · Etapa".
 * Ordenadas por embudo y posición.
 */
export async function stageOptions(client: Client = db) {
  const funnels = await client.funnel.findMany({
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    include: { stages: { orderBy: { position: "asc" } } },
  });
  const many = funnels.filter((f) => f.stages.length).length > 1;
  return funnels.flatMap((f) => f.stages.map((s) => ({ ...s, label: many ? `${f.name} · ${s.name}` : s.name, funnelName: f.name })));
}

export async function createFunnel(name: string) {
  const clean = name.trim();
  if (!clean) throw new DomainError("Escribe el nombre del embudo.");
  if (await db.funnel.findFirst({ where: { name: { equals: clean, mode: "insensitive" } } })) {
    throw new DomainError(`Ya existe un embudo "${clean}".`);
  }
  const last = await db.funnel.findFirst({ orderBy: { position: "desc" } });
  return db.funnel.create({ data: { name: clean, position: (last?.position ?? -1) + 1 } });
}

export async function updateFunnel(
  id: string,
  data: { name: string; channels: Channel[]; assistantName: string; instructions: string },
) {
  const name = data.name.trim();
  if (!name) throw new DomainError("Escribe el nombre del embudo.");
  const other = await db.funnel.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  if (other && other.id !== id) throw new DomainError(`Ya existe un embudo "${name}".`);
  await db.$transaction(async (tx) => {
    // Un canal lleva sus leads nuevos a un solo embudo: se quita de los demás.
    for (const f of await tx.funnel.findMany({ where: { id: { not: id }, channels: { hasSome: data.channels } } })) {
      await tx.funnel.update({ where: { id: f.id }, data: { channels: f.channels.filter((c) => !data.channels.includes(c)) } });
    }
    await tx.funnel.update({
      where: { id },
      data: {
        name,
        channels: [...new Set(data.channels)],
        assistantName: data.assistantName.trim() || null,
        instructions: data.instructions.trim() || null,
      },
    });
  });
}

/** Solo se borra un embudo sin leads, y nunca el original. Sus etapas se borran con él. */
export async function deleteFunnel(id: string) {
  if (id === DEFAULT_FUNNEL_ID) throw new DomainError("El primer embudo no se puede borrar (puedes cambiarle el nombre).");
  if (await db.lead.count({ where: { stage: { funnelId: id } } })) {
    throw new DomainError("El embudo tiene leads: muévelos a otro embudo antes de borrarlo.");
  }
  await db.$transaction([db.stage.deleteMany({ where: { funnelId: id } }), db.funnel.delete({ where: { id } })]);
}
