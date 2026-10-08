import { db } from "./db";

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

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.setting.findUnique({ where: { key } });
  return row ? (row.value as T) : fallback;
}

export async function setSetting<T>(key: string, value: T) {
  await db.setting.upsert({
    where: { key },
    create: { key, value: value as object },
    update: { value: value as object },
  });
}

export async function getAssistantSettings(): Promise<AssistantSettings> {
  const saved = await getSetting<Partial<AssistantSettings>>("assistant", {});
  return { ...DEFAULT_ASSISTANT, ...saved };
}
