import { db } from "../db";
import { completeOnce, jsonIn } from "../ai/complete";
import type { ProviderClients } from "../ai/providers";
import { DEFAULT_ASSISTANT, getAssistantSettings, setSetting, type AssistantSettings } from "../settings";
import { primaryFunnelId } from "./default-funnel";
import { DomainError } from "./leads";

/**
 * "Presenta a tu asistente": una empresa nueva responde unas pocas preguntas y la IA redacta sus
 * instrucciones, un primer documento de conocimiento y las reglas de avance de las etapas que
 * atiende la IA. Nada se guarda hasta que el admin revisa y confirma.
 */

export type SetupAnswers = {
  companyName: string;
  assistantName: string;
  /** Qué vende la empresa y a quién. */
  offer: string;
  tone: string;
  /** Datos que la asistente debe pedir para calificar a un cliente. */
  qualify: string;
  /** Cuándo pasar la conversación a una persona. */
  handoff: string;
  /** Qué no debe decir ni prometer. */
  avoid: string;
  /** Preguntas frecuentes, precios, políticas, horarios: lo que la empresa quiera pegar. */
  facts: string;
};

export type SetupDraft = {
  assistantName: string;
  companyName: string;
  instructions: string;
  docs: { title: string; content: string }[];
  stages: { id: string; name: string; exitCriteria: string }[];
};

const MAX_ANSWER = 4000;
const MAX_FACTS = 20_000;

const SETUP_PROMPT = `Eres quien configura la asistente de ventas por chat (WhatsApp, Instagram, Messenger) de una empresa en Beliapp, un CRM de leads. Con las respuestas de la empresa redactas su configuración inicial.

La asistente ya trae, fijas en el sistema, estas capacidades: mover al lead de etapa, etiquetarlo, guardar sus datos, agendar seguimientos, crear tareas, enviar archivos y derivar a una persona (handoff). También recibe el estado del CRM y la base de conocimiento en cada turno. No las expliques ni repitas en las instrucciones: escribe solo lo propio de esta empresa.

Devuelve solo un objeto JSON con estas claves:
- "instrucciones": texto en segunda persona dirigido a la asistente ("Eres ..., la asistente de ..."). Incluye quién es y a quién atiende, el tono, cómo calificar (qué datos pedir y en qué orden, de a una pregunta), cuándo derivar a una persona y qué no debe decir ni prometer. Breve y claro, con viñetas donde ayude; entre 150 y 450 palabras. No incluyas precios, productos ni políticas: eso va en la base de conocimiento.
- "conocimiento": lista de documentos {"titulo", "contenido"} con los datos concretos que la empresa entregó (productos, precios, formas de pago, preguntas frecuentes, políticas, horarios, ubicación), uno por tema. Usa solo lo que la empresa escribió, sin inventar ni completar datos. Si no entregó datos concretos, devuelve una lista vacía.
- "etapas": lista {"nombre", "regla"} solo para las etapas que atiende la IA que te paso. La regla dice cuándo sacar al lead de esa etapa y hacia cuál, según los datos que la empresa quiere para calificar. Usa los nombres de etapa exactos.

Escribe en español de Chile.`;

const clean = (s: string, max = MAX_ANSWER) => s.trim().slice(0, max);

/** Etapas del embudo principal que atiende la IA (las de atención humana las sigue una persona). */
async function aiStages() {
  return db.stage.findMany({
    where: { funnelId: await primaryFunnelId(), requiresHuman: false },
    orderBy: { position: "asc" },
  });
}

/** Pide a la IA la configuración propuesta. No guarda nada. */
export async function draftAssistantSetup(answers: SetupAnswers, clients: ProviderClients = {}): Promise<SetupDraft> {
  const a = { ...answers, facts: clean(answers.facts, MAX_FACTS) };
  for (const key of ["companyName", "assistantName", "offer", "tone", "qualify", "handoff", "avoid"] as const) {
    a[key] = clean(a[key]);
  }
  if (!a.companyName) throw new DomainError("Escribe el nombre de la empresa.");
  if (!a.offer) throw new DomainError("Cuéntanos qué vende la empresa y a quién.");
  const assistantName = a.assistantName || DEFAULT_ASSISTANT.assistantName;

  const [stages, all] = await Promise.all([
    aiStages(),
    db.stage.findMany({ where: { funnelId: await primaryFunnelId() }, orderBy: { position: "asc" } }),
  ]);
  const input = [
    `Empresa: ${a.companyName}`,
    `Nombre de la asistente: ${assistantName}`,
    `Qué vende y a quién: ${a.offer}`,
    `Tono: ${a.tone || "cercano y profesional"}`,
    `Datos para calificar: ${a.qualify || "(no lo dijo; propón lo básico para esta venta)"}`,
    `Cuándo derivar a una persona: ${a.handoff || "(no lo dijo; propón lo razonable)"}`,
    `Qué no decir ni prometer: ${a.avoid || "(no lo dijo)"}`,
    `Etapas del embudo en orden: ${all.map((s) => `"${s.name}"${s.requiresHuman ? " (atención humana)" : ""}`).join(", ") || "ninguna"}`,
    `Etapas que atiende la IA: ${stages.map((s) => `"${s.name}"`).join(", ") || "ninguna"}`,
    "<datos_de_la_empresa>",
    a.facts || "(sin datos)",
    "</datos_de_la_empresa>",
  ].join("\n");

  const maxTokens = Math.min(32_000, Math.ceil(a.facts.length / 3) * 1.3 + 8_000);
  const { text } = await completeOnce({ system: SETUP_PROMPT, input, maxTokens, effort: "low", clients });
  const json = jsonIn(text) as { instrucciones?: unknown; conocimiento?: unknown; etapas?: unknown } | null;
  const instructions = typeof json?.instrucciones === "string" ? json.instrucciones.trim() : "";
  if (!instructions) throw new DomainError("La IA no devolvió las instrucciones. Intenta de nuevo.");

  const docs = (Array.isArray(json?.conocimiento) ? json.conocimiento : [])
    .map((d: { titulo?: unknown; contenido?: unknown }) => ({
      title: typeof d?.titulo === "string" ? d.titulo.trim() : "",
      content: typeof d?.contenido === "string" ? d.contenido.trim() : "",
    }))
    .filter((d) => d.title && d.content);

  const rules = new Map<string, string>();
  for (const r of Array.isArray(json?.etapas) ? json.etapas : []) {
    if (typeof r?.nombre === "string" && typeof r?.regla === "string") rules.set(r.nombre.trim(), r.regla.trim());
  }
  return {
    assistantName,
    companyName: a.companyName,
    instructions,
    docs,
    stages: stages.map((s) => ({ id: s.id, name: s.name, exitCriteria: rules.get(s.name) || s.exitCriteria || "" })),
  };
}

/**
 * Guarda la configuración revisada: nombre, empresa e instrucciones de la asistente; crea o
 * actualiza los documentos por título (sin tocar los demás) y fija las reglas de avance de las
 * etapas del embudo principal.
 */
export async function applyAssistantSetup(draft: SetupDraft) {
  const instructions = draft.instructions.trim();
  if (!instructions) throw new DomainError("Las instrucciones no pueden quedar vacías.");
  const current = await getAssistantSettings();
  await setSetting<AssistantSettings>("assistant", {
    ...current,
    assistantName: draft.assistantName.trim() || current.assistantName,
    companyName: draft.companyName.trim() || current.companyName,
    instructions,
  });

  for (const doc of draft.docs) {
    const title = doc.title.trim();
    const content = doc.content.trim();
    if (!title || !content) continue;
    const existing = await db.knowledgeDoc.findFirst({ where: { title } });
    if (existing) await db.knowledgeDoc.update({ where: { id: existing.id }, data: { content } });
    else await db.knowledgeDoc.create({ data: { title, content } });
  }

  const ids = new Set((await aiStages()).map((s) => s.id));
  for (const s of draft.stages) {
    if (!ids.has(s.id)) continue;
    await db.stage.update({ where: { id: s.id }, data: { exitCriteria: s.exitCriteria.trim() || null } });
  }
}

/** La asistente ya tiene instrucciones y empresa propias (no las de respaldo). */
export function assistantConfigured(s: AssistantSettings) {
  return s.instructions.trim() !== DEFAULT_ASSISTANT.instructions && s.companyName.trim() !== DEFAULT_ASSISTANT.companyName && Boolean(s.instructions.trim());
}
