import type { AssignStrategy, Prisma, PrismaClient } from "@prisma/client";
import type { AssistantSettings } from "../settings";
import type { InventorySettings } from "../inventory";

/**
 * Configuración predefinida para una empresa: instrucciones de la asistente, base de
 * conocimiento, inventario, funnel, etiquetas y reglas de asignación. Se aplica una sola vez por versión; para volver a cargarla
 * (por ejemplo tras cambiar sus textos) se sube `version`.
 */
export type Preset = {
  id: string;
  version: number;
  assistant: AssistantSettings;
  knowledge: { title: string; content: string }[];
  inventorySheetUrl?: string;
  /**
   * Etapas del funnel en orden. Una etapa existente se reutiliza si tiene el mismo nombre
   * o uno de `replaces` (así los leads que ya estaban en ella se conservan). Las etapas que
   * no están en el preset no se borran: quedan al final.
   */
  stages?: { name: string; color: string; requiresHuman?: boolean; replaces?: string[] }[];
  tags?: { category: string; color: string; names: string[] }[];
  /** Reglas por etapa; sin ejecutivos listados, reparten entre todos los ejecutivos activos. */
  stageRules?: { name: string; stage: string; strategy: AssignStrategy }[];
};

type Db = PrismaClient | Prisma.TransactionClient;

const presetKey = (id: string) => `preset:${id}`;

async function readSetting<T>(tx: Db, key: string): Promise<T | undefined> {
  const row = await tx.setting.findUnique({ where: { key } });
  return row ? (row.value as T) : undefined;
}

async function writeSetting<T>(tx: Db, key: string, value: T) {
  await tx.setting.upsert({
    where: { key },
    create: { key, value: value as object },
    update: { value: value as object },
  });
}

/**
 * Carga el preset si aún no se aplicó esta versión. Reemplaza la configuración de la
 * asistente, crea o actualiza los documentos por título (sin tocar los demás), fija la
 * planilla de inventario, ordena el funnel y agrega las etiquetas y reglas que falten
 * (nunca borra). Devuelve true si aplicó cambios.
 */
export async function applyPreset(db: PrismaClient, preset: Preset): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const applied = await readSetting<{ version: number }>(tx, presetKey(preset.id));
    if (applied && applied.version >= preset.version) return false;

    await writeSetting<AssistantSettings>(tx, "assistant", preset.assistant);

    for (const doc of preset.knowledge) {
      const existing = await tx.knowledgeDoc.findFirst({ where: { title: doc.title } });
      if (existing) await tx.knowledgeDoc.update({ where: { id: existing.id }, data: { content: doc.content } });
      else await tx.knowledgeDoc.create({ data: doc });
    }

    if (preset.inventorySheetUrl) {
      const current = await readSetting<InventorySettings>(tx, "inventory");
      if (current?.sheetUrl !== preset.inventorySheetUrl) {
        await writeSetting<InventorySettings>(tx, "inventory", { sheetUrl: preset.inventorySheetUrl });
      }
    }

    if (preset.stages) await applyStages(tx, preset.stages);

    for (const group of preset.tags ?? []) {
      for (const name of group.names) {
        await tx.tag.upsert({
          where: { category_name: { category: group.category, name } },
          create: { category: group.category, name, color: group.color },
          update: {},
        });
      }
    }

    for (const rule of preset.stageRules ?? []) {
      const stage = await tx.stage.findUnique({ where: { name: rule.stage } });
      if (!stage || (await tx.assignmentRule.findFirst({ where: { name: rule.name } }))) continue;
      await tx.assignmentRule.create({
        data: { name: rule.name, trigger: "STAGE_ENTERED", stageId: stage.id, strategy: rule.strategy },
      });
    }

    await writeSetting(tx, presetKey(preset.id), { version: preset.version, appliedAt: new Date().toISOString() });
    return true;
  });
}

async function applyStages(tx: Prisma.TransactionClient, stages: NonNullable<Preset["stages"]>) {
  const existing = await tx.stage.findMany({ orderBy: { position: "asc" } });
  const used = new Set<string>();
  for (const [position, s] of stages.entries()) {
    const match =
      existing.find((e) => e.name === s.name) ??
      existing.find((e) => !used.has(e.id) && s.replaces?.includes(e.name) && !stages.some((o) => o.name === e.name));
    const data = { name: s.name, color: s.color, requiresHuman: s.requiresHuman ?? false, position };
    if (match) {
      used.add(match.id);
      await tx.stage.update({ where: { id: match.id }, data });
    } else {
      await tx.stage.create({ data });
    }
  }
  let position = stages.length;
  for (const s of existing) {
    if (!used.has(s.id)) await tx.stage.update({ where: { id: s.id }, data: { position: position++ } });
  }
}
