import { Prisma } from "@prisma/client";
import { db } from "./db";
import { currentCompanyId } from "./tenant";

export type AssistantSettings = {
  assistantName: string;
  companyName: string;
  instructions: string;
};

export const DEFAULT_ASSISTANT: AssistantSettings = {
  assistantName: "Bella",
  companyName: "nuestra empresa",
  instructions:
    "Atiende con cordialidad y en español de Chile. Responde de forma breve (2 a 4 frases), " +
    "haz una pregunta a la vez para calificar al cliente y nunca inventes precios ni stock.",
};

/** Configuración de la empresa en curso (ver tenant.ts). */
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const companyId = await currentCompanyId();
  const row = await db.companySetting
    .findUnique({ where: { companyId_key: { companyId, key } } })
    .catch(async (err) => {
      // Un preview usa la base de producción, que no tiene esta tabla hasta que se mergea: lee
      // la tabla de antes. Se puede quitar cuando "Setting" se borre.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2021")) throw err;
      return db.setting.findUnique({ where: { key } });
    });
  return row ? (row.value as T) : fallback;
}

export async function setSetting<T>(key: string, value: T) {
  const companyId = await currentCompanyId();
  await db.companySetting.upsert({
    where: { companyId_key: { companyId, key } },
    create: { key, value: value as object },
    update: { value: value as object },
  });
}

export async function getAssistantSettings(): Promise<AssistantSettings> {
  const saved = await getSetting<Partial<AssistantSettings>>("assistant", {});
  return { ...DEFAULT_ASSISTANT, ...saved };
}
