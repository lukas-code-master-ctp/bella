import type { Prisma, PrismaClient } from "@prisma/client";
import type { AssistantSettings } from "../settings";
import type { InventorySettings } from "../inventory";

/**
 * Configuración predefinida de la asistente para una empresa: instrucciones, base de
 * conocimiento e inventario. Se aplica una sola vez por versión; para volver a cargarla
 * (por ejemplo tras cambiar sus textos) se sube `version`.
 */
export type Preset = {
  id: string;
  version: number;
  assistant: AssistantSettings;
  knowledge: { title: string; content: string }[];
  inventorySheetUrl?: string;
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
 * asistente, crea o actualiza los documentos por título (sin tocar los demás) y fija la
 * planilla de inventario. Devuelve true si aplicó cambios.
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

    await writeSetting(tx, presetKey(preset.id), { version: preset.version, appliedAt: new Date().toISOString() });
    return true;
  });
}
