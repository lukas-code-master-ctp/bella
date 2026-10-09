import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { db } from "../db";
import { getAssistantSettings } from "../settings";
import { getAiConfig } from "./config";
import { openRouterClient, type ProviderClients } from "./providers";

/**
 * Resumen de una línea y puntaje (0-100) del lead, para decidir a quién atender primero sin abrir
 * cada chat. Se calcula aparte del turno de la asistente, con un modelo chico y solo la
 * conversación visible: no toca el historial de la IA (AgentTranscript).
 */

const MAX_MESSAGES = 40;
const MAX_CHARS_PER_MESSAGE = 600;

const Insights = z.object({
  resumen: z.string().min(1),
  puntaje: z.coerce.number(),
  motivo: z.string().default(""),
});

export type LeadInsights = { summary: string; score: number; reason: string };

function insightsPrompt(companyName: string) {
  return [
    `Eres analista comercial de ${companyName}. Lees la conversación de un lead con el equipo de ventas ` +
      "(asistente IA y ejecutivos) y respondes solo con un objeto JSON, sin texto adicional:",
    '{"resumen": string, "puntaje": number, "motivo": string}',
    "",
    "- resumen: una sola línea (máximo 120 caracteres), en español de Chile y en tercera persona, de dónde " +
      'quedó la conversación y qué sigue. Ej.: "Pidió precios y formas de pago; revisará la info y volverá a escribir."',
    "- puntaje: de 0 a 100, qué tan probable es que compre. 0-39 bajo: curiosea, sin presupuesto, dejó de " +
      "responder, spam o no es cliente. 40-69 medio: interés concreto pero le falta definir producto, " +
      "presupuesto o plazo. 70-100 alto: producto definido, presupuesto o financiamiento claro, quiere " +
      "visitar, cotizar o comprar pronto.",
    "- motivo: una frase corta con lo que justifica el puntaje.",
  ].join("\n");
}

export function parseInsights(text: string): LeadInsights | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    const parsed = Insights.safeParse(JSON.parse(text.slice(start, end + 1)));
    if (!parsed.success || !Number.isFinite(parsed.data.puntaje)) return null;
    const oneLine = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);
    return {
      summary: oneLine(parsed.data.resumen, 200),
      score: Math.min(100, Math.max(0, Math.round(parsed.data.puntaje))),
      reason: oneLine(parsed.data.motivo, 300),
    };
  } catch {
    return null;
  }
}

let anthropicDefault: Anthropic | null = null;

/**
 * Recalcula el resumen y el puntaje si hay mensajes nuevos desde la última vez (o siempre, con
 * `force`). Pensado para correr después de responder (con `after()` en las server actions), así no
 * demora la respuesta. Nunca lanza: si el modelo falla, el lead queda con el resumen anterior.
 */
export async function refreshLeadInsights(
  leadId: string,
  { clients = {}, force = false }: { clients?: ProviderClients; force?: boolean } = {},
): Promise<boolean> {
  try {
    const lead = await db.lead.findUniqueOrThrow({
      where: { id: leadId },
      include: {
        stage: true,
        contact: { include: { tags: { include: { tag: true } } } },
        messages: { include: { user: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: MAX_MESSAGES },
      },
    });
    const latest = lead.messages[0];
    if (!latest) return false;
    if (!force && lead.insightsAt && latest.createdAt <= lead.insightsAt) return false;

    const [settings, config] = await Promise.all([getAssistantSettings(), getAiConfig()]);
    const tags = lead.contact.tags.map((ct) => `${ct.tag.category}: ${ct.tag.name}`);
    const conversation = [...lead.messages]
      .reverse()
      .map((m) => {
        const who = m.author === "CONTACT" ? "Cliente" : m.author === "AI" ? "Asistente IA" : `Ejecutivo (${m.user?.name ?? "equipo"})`;
        const text = m.mediaUrl ? `[nota de voz] ${m.transcript ?? "(sin transcripción)"} ${m.body}`.trim() : m.body;
        return `${who}: ${text.slice(0, MAX_CHARS_PER_MESSAGE)}`;
      })
      .join("\n");
    const input = [
      `Etapa del funnel: ${lead.stage.name}`,
      `Etiquetas: ${tags.length ? tags.join(", ") : "ninguna"}`,
      "",
      "<conversacion>",
      conversation,
      "</conversacion>",
    ].join("\n");
    const system = insightsPrompt(settings.companyName);

    let text: string;
    if (config.provider === "anthropic") {
      const api = clients.anthropic ?? (anthropicDefault ??= new Anthropic());
      const response = await api.beta.messages.create({
        model: config.summaryModel,
        max_tokens: 400,
        system,
        messages: [{ role: "user", content: input }],
      });
      text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    } else {
      const response = await (clients.openrouter ?? openRouterClient).complete({
        model: config.summaryModel,
        max_tokens: 400,
        messages: [
          { role: "system", content: system },
          { role: "user", content: input },
        ],
      });
      text = response.choices?.[0]?.message.content ?? "";
    }

    const insights = parseInsights(text);
    if (!insights) throw new Error(`respuesta sin JSON válido: ${text.slice(0, 200)}`);
    await db.lead.update({
      where: { id: leadId },
      data: {
        aiSummary: insights.summary,
        score: insights.score,
        scoreReason: insights.reason || null,
        insightsAt: latest.createdAt,
      },
    });
    return true;
  } catch (err) {
    console.error(`[insights] lead ${leadId}:`, err);
    return false;
  }
}
