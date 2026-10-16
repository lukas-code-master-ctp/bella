import type { AiLesson, AiLessonStatus } from "@prisma/client";
import { db } from "../db";
import { buildSystemPrompt } from "../ai/agent";
import { completeOnce, jsonIn } from "../ai/complete";
import type { ProviderClients } from "../ai/providers";
import { knowledgeForPrompt } from "../knowledge";
import { getAssistantSettings, type AssistantSettings } from "../settings";
import { applyVariant } from "./ab-tests";
import { filesForPrompt } from "./files";
import { assistantFor } from "./funnels";
import { DomainError } from "./leads";

/**
 * Aprendizajes de la asistente. Alguien del equipo corrige una respuesta de la IA desde el chat,
 * la IA la convierte en una regla general con su ejemplo, y queda pendiente. Solo cuando un admin
 * la aprueba (ACTIVE) la asistente la recibe en sus instrucciones. Antes de aprobarla se puede
 * probar: la IA vuelve a escribir la respuesta corregida con la regla puesta.
 */

/** Mensajes de la conversación que ve la IA al redactar o probar una regla. */
const CONVERSATION_MESSAGES = 30;
const MAX_RULE = 600;
const MAX_EXAMPLE = 1500;

export type LessonForPrompt = Pick<AiLesson, "rule" | "badExample" | "goodExample">;

export type LessonDraft = { rule: string; goodExample: string; badExample: string; conflict: string };

/** Aprendizajes aprobados y encendidos, en el orden en que se aprobaron. */
export async function activeLessons(): Promise<LessonForPrompt[]> {
  return db.aiLesson.findMany({
    where: { status: "ACTIVE" },
    select: { rule: true, badExample: true, goodExample: true },
    orderBy: [{ approvedAt: "asc" }, { createdAt: "asc" }],
  });
}

/** Sección de las instrucciones con los aprendizajes (vacía si no hay). */
export function lessonsPrompt(lessons: LessonForPrompt[]): string[] {
  if (!lessons.length) return [];
  return [
    "",
    "Aprendizajes aprobados por la empresa (correcciones a respuestas tuyas anteriores; si chocan " +
      "con las instrucciones de arriba, mandan estos):",
    ...lessons.map((l) => {
      const lines = [`- ${l.rule.trim()}`];
      if (l.badExample.trim()) lines.push(`  Evita responder así: "${oneLine(l.badExample)}"`);
      if (l.goodExample.trim()) lines.push(`  Mejor así: "${oneLine(l.goodExample)}"`);
      return lines.join("\n");
    }),
  ];
}

const oneLine = (s: string) => s.trim().replace(/\s*\n+\s*/g, " ");

/** La asistente tal como atiende a ese lead: con lo propio de su embudo y su variante A/B. */
async function assistantForLead(leadId: string | null): Promise<AssistantSettings> {
  const base = await getAssistantSettings();
  if (!leadId) return base;
  const lead = await db.lead.findUnique({
    where: { id: leadId },
    include: { stage: { include: { funnel: true } }, variant: true },
  });
  if (!lead) return base;
  return applyVariant(assistantFor(base, lead.stage.funnel), lead.variant);
}

/** La conversación visible antes de un mensaje, como la leería una persona. */
async function conversationBefore(message: { leadId: string; createdAt: Date }, assistantName: string) {
  const messages = await db.message.findMany({
    where: { leadId: message.leadId, createdAt: { lt: message.createdAt } },
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: CONVERSATION_MESSAGES,
  });
  return messages
    .reverse()
    .map((m) => {
      const body = m.transcript ?? m.body ?? "";
      const text = m.mediaUrl && !m.transcript ? `[archivo${m.mediaName ? ` ${m.mediaName}` : ""}] ${body}` : body;
      const who = m.author === "CONTACT" ? "Cliente" : m.author === "AI" ? `${assistantName} (asistente)` : `Ejecutivo (${m.user?.name ?? "equipo"})`;
      return `${who}: ${text.trim()}`;
    })
    .join("\n");
}

const DRAFT_PROMPT = [
  "Ayudas a una empresa a ajustar a su asistente de ventas por chat. Alguien del equipo corrigió una " +
    "respuesta de la asistente y tú conviertes esa corrección en un aprendizaje.",
  "",
  "- regla: una o dos frases en imperativo, dirigidas a la asistente, que sirvan para conversaciones " +
    "parecidas en el futuro y no solo para este cliente. No incluyas datos de este cliente (nombre, " +
    "teléfono, correo).",
  "- ejemplo_bueno: cómo debió ser esa misma respuesta, como mensaje de chat listo para enviar, con el " +
    "tono y el largo que piden las instrucciones.",
  "- choque: si la regla contradice las instrucciones actuales o un aprendizaje ya aprobado, explícalo en " +
    "una frase citando lo que choca; si no hay choque, déjalo vacío.",
  "",
  'Responde solo un JSON: {"regla": "...", "ejemplo_bueno": "...", "choque": ""}',
].join("\n");

/**
 * La IA redacta la regla a partir de la corrección de una respuesta suya. No guarda nada: quien
 * corrigió la revisa y la edita antes de guardarla.
 */
export async function draftLesson(
  { messageId, feedback }: { messageId: string; feedback: string },
  clients: ProviderClients = {},
): Promise<LessonDraft & { conversation: string; leadId: string }> {
  const text = feedback.trim();
  if (!text) throw new DomainError("Escribe qué estuvo mal y cómo debió responder.");
  const message = await db.message.findUnique({ where: { id: messageId } });
  if (!message || message.author !== "AI") throw new DomainError("Solo se pueden corregir mensajes de la IA.");

  const settings = await assistantForLead(message.leadId);
  const [conversation, lessons] = await Promise.all([conversationBefore(message, settings.assistantName), activeLessons()]);
  const input = [
    "<instrucciones>",
    settings.instructions,
    "</instrucciones>",
    "<aprendizajes_aprobados>",
    lessons.length ? lessons.map((l) => `- ${l.rule}`).join("\n") : "ninguno",
    "</aprendizajes_aprobados>",
    "<conversacion>",
    conversation || "(sin mensajes anteriores)",
    "</conversacion>",
    "<respuesta_de_la_asistente>",
    message.body,
    "</respuesta_de_la_asistente>",
    "<correccion>",
    text,
    "</correccion>",
  ].join("\n");

  const { text: reply } = await completeOnce({ system: DRAFT_PROMPT, input, maxTokens: 1500, clients });
  const parsed = jsonIn(reply) as { regla?: unknown; ejemplo_bueno?: unknown; choque?: unknown } | null;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return {
    // Si la IA no respondió en JSON, la regla parte siendo la corrección tal cual.
    rule: str(parsed?.regla) || text,
    goodExample: str(parsed?.ejemplo_bueno),
    badExample: message.body,
    conflict: str(parsed?.choque),
    conversation,
    leadId: message.leadId,
  };
}

export type LessonInput = { rule: string; goodExample: string; badExample: string };

function clean(input: LessonInput) {
  const rule = input.rule.trim();
  if (!rule) throw new DomainError("Escribe la regla.");
  if (rule.length > MAX_RULE) throw new DomainError(`La regla puede tener hasta ${MAX_RULE} caracteres.`);
  const goodExample = input.goodExample.trim();
  const badExample = input.badExample.trim();
  if (goodExample.length > MAX_EXAMPLE || badExample.length > MAX_EXAMPLE) {
    throw new DomainError(`Cada ejemplo puede tener hasta ${MAX_EXAMPLE} caracteres.`);
  }
  return { rule, goodExample, badExample };
}

/** Guarda la corrección como aprendizaje pendiente de aprobación. */
export async function createLesson(
  input: LessonInput & { feedback: string; conflict: string; messageId: string; createdBy: string },
) {
  const message = await db.message.findUnique({ where: { id: input.messageId } });
  if (!message || message.author !== "AI") throw new DomainError("Solo se pueden corregir mensajes de la IA.");
  const settings = await assistantForLead(message.leadId);
  return db.aiLesson.create({
    data: {
      ...clean(input),
      feedback: input.feedback.trim(),
      conflict: input.conflict.trim(),
      conversation: await conversationBefore(message, settings.assistantName),
      leadId: message.leadId,
      messageId: message.id,
      createdBy: input.createdBy,
    },
  });
}

/** Editar la regla borra la prueba anterior: ya no corresponde a lo escrito. */
export async function updateLesson(id: string, input: LessonInput) {
  const data = clean(input);
  const current = await db.aiLesson.findUniqueOrThrow({ where: { id } });
  const changed = data.rule !== current.rule || data.goodExample !== current.goodExample || data.badExample !== current.badExample;
  return db.aiLesson.update({
    where: { id },
    data: { ...data, ...(changed ? { testReply: null, testedAt: null } : {}) },
  });
}

/** Aprobar (ACTIVE), pausar (PAUSED). Al aprobar por primera vez queda la fecha. */
export async function setLessonStatus(id: string, status: Exclude<AiLessonStatus, "PENDING">) {
  const current = await db.aiLesson.findUniqueOrThrow({ where: { id } });
  return db.aiLesson.update({
    where: { id },
    data: { status, ...(status === "ACTIVE" && !current.approvedAt ? { approvedAt: new Date() } : {}) },
  });
}

export async function deleteLesson(id: string) {
  await db.aiLesson.delete({ where: { id } });
}

/** Para la pantalla de Aprendizajes: pendientes primero, luego activos y pausados. */
export async function listLessons() {
  const lessons = await db.aiLesson.findMany({ orderBy: { createdAt: "desc" } });
  const order: Record<AiLessonStatus, number> = { PENDING: 0, ACTIVE: 1, PAUSED: 2 };
  return lessons.sort((a, b) => order[a.status] - order[b.status]);
}

export async function pendingLessonCount() {
  return db.aiLesson.count({ where: { status: "PENDING" } });
}

/**
 * Prueba la regla: la IA vuelve a escribir la respuesta corregida con los aprendizajes activos más
 * este. Es una sola llamada sin herramientas y no se envía a nadie. Guarda el resultado.
 */
export async function testLesson(id: string, clients: ProviderClients = {}) {
  const lesson = await db.aiLesson.findUniqueOrThrow({ where: { id } });
  const settings = await assistantForLead(lesson.leadId);
  const [knowledge, files, active] = await Promise.all([knowledgeForPrompt(), filesForPrompt(), activeLessons()]);
  const others = lesson.status === "ACTIVE" ? active.filter((l) => l.rule !== lesson.rule) : active;
  const system = buildSystemPrompt(settings, knowledge, files, null, [...others, lesson]);
  const input = [
    "(Prueba de una regla nueva: en esta prueba no tienes herramientas ni <crm_state>. Escribe solo el " +
      "mensaje que le enviarías ahora al cliente, usando lo que sabes de la conversación y de la base de conocimiento.)",
    "",
    "<conversacion>",
    lesson.conversation || "(sin mensajes anteriores)",
    "</conversacion>",
  ].join("\n");
  const { text } = await completeOnce({ system, input, maxTokens: 1000, clients });
  const testReply = text.trim();
  if (!testReply) throw new DomainError("La IA no devolvió una respuesta. Intenta de nuevo.");
  return db.aiLesson.update({ where: { id }, data: { testReply, testedAt: new Date() } });
}
