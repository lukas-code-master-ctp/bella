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
  const row = await db.companySetting.findUnique({ where: { companyId_key: { companyId, key } } });
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
