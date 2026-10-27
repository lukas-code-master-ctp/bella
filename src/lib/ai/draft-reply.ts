import { db } from "../db";
import { TEAM_AUTHOR, teamAuthor } from "./team-author";
import { activeLessons, lessonsPrompt } from "../domain/ai-lessons";
import { DomainError } from "../domain/leads";
import { searchInventory } from "../inventory";
import { knowledgeForPrompt, searchKnowledge } from "../knowledge";
import { getAssistantSettings } from "../settings";
import { completeOnce } from "./complete";
import type { ProviderClients } from "./providers";

/*
 * "@ia" en el chat del lead: la IA le redacta al ejecutivo el próximo mensaje según la
 * conversación. Es un borrador: vuelve al campo de texto y el ejecutivo lo revisa antes de enviar.
 * Es una llamada suelta con la conversación visible: no toca el historial de la asistente.
 */

const MAX_MESSAGES = 40;
const MAX_CHARS_PER_MESSAGE = 1200;
export const DRAFT_HINT_MAX = 500;

function draftPrompt(companyName: string, instructions: string, userName: string) {
  return [
    `Ayudas a ${userName}, ejecutivo de ventas de ${companyName}, a escribir su próximo mensaje a un ` +
      "cliente por chat. Lees la conversación y redactas el mensaje que el ejecutivo le enviaría ahora.",
    "",
    "Cómo redactas:",
    "- Escribes como el ejecutivo, en primera persona y con su nombre si corresponde presentarse; " +
      "no como asistente virtual.",
    "- Respondes lo que el cliente preguntó o dejó pendiente y llevas la conversación hacia el siguiente " +
      "paso de la venta.",
    "- Usa solo los datos de la conversación, de <base_de_conocimiento> y de <inventario>. Si falta un " +
      "dato (precio, stock, fecha), no lo inventes: deja el hueco entre corchetes, por ejemplo [precio], " +
      "para que el ejecutivo lo complete.",
    "- Si viene <pedido_del_ejecutivo>, sigue esa indicación.",
    "- Devuelve solo el texto del mensaje, listo para enviar: texto plano, sin comillas, sin markdown " +
      "ni explicaciones.",
    "",
    "Estilo e instrucciones de la empresa (son las de la asistente IA; aplica el tono y las reglas, " +
      "no su nombre):",
    instructions,
  ].join("\n");
}

/** Redacta el próximo mensaje del ejecutivo. `hint` es lo que escribió después de "@ia". */
export async function draftExecutiveReply(
  leadId: string,
  userName: string,
  hint = "",
  { clients = {} }: { clients?: ProviderClients } = {},
): Promise<string> {
  const lead = await db.lead.findUniqueOrThrow({
    where: { id: leadId },
    include: {
      stage: true,
      contact: { include: { tags: { include: { tag: true } } } },
      messages: { include: TEAM_AUTHOR, orderBy: { createdAt: "desc" }, take: MAX_MESSAGES },
    },
  });
  const messages = [...lead.messages].reverse();
  const cleanHint = hint.trim().slice(0, DRAFT_HINT_MAX);
  if (!messages.length && !cleanHint) {
    throw new DomainError('Aún no hay conversación. Escribe después de "@ia" qué quieres decirle al cliente.');
  }

  // Para buscar en inventario y conocimiento: lo último que dijo el cliente y el pedido del ejecutivo.
  const lastFromContact = messages.filter((m) => m.author === "CONTACT").slice(-3).map((m) => m.transcript ?? m.body);
  const query = [...lastFromContact, cleanHint].join(" ");
  const [settings, inlineKnowledge, lessons, inventory] = await Promise.all([
    getAssistantSettings(),
    knowledgeForPrompt(),
    activeLessons(),
    searchInventory(query, 10),
  ]);
  const knowledge = inlineKnowledge ?? (await searchKnowledge(query, 3));

  const conversation = messages
    .map((m) => {
      const who = m.author === "CONTACT" ? "Cliente" : m.author === "AI" ? "Asistente IA" : teamAuthor(m);
      const text = m.mediaUrl ? `[${m.transcript ? "nota de voz" : "archivo"}] ${m.transcript ?? ""} ${m.body}`.trim() : m.body;
      return `${who}: ${text.slice(0, MAX_CHARS_PER_MESSAGE)}`;
    })
    .join("\n");
  const tags = lead.contact.tags.map((ct) => `${ct.tag.category}: ${ct.tag.name}`);
  const input = [
    `Cliente: ${lead.contact.name}`,
    `Etapa del funnel: ${lead.stage.name}`,
    `Etiquetas: ${tags.length ? tags.join(", ") : "ninguna"}`,
    "",
    "<conversacion>",
    conversation || "(todavía no hay mensajes)",
    "</conversacion>",
    ...(cleanHint ? ["", "<pedido_del_ejecutivo>", cleanHint, "</pedido_del_ejecutivo>"] : []),
  ].join("\n");

  const system = [
    draftPrompt(settings.companyName, settings.instructions, userName),
    ...lessonsPrompt(lessons),
    ...(knowledge.length
      ? [
          "",
          "<base_de_conocimiento>",
          ...knowledge.map((d) => `<documento titulo="${d.title}">\n${d.content}\n</documento>`),
          "</base_de_conocimiento>",
        ]
      : []),
    ...(inventory.length ? ["", "<inventario>", ...inventory.map((row) => JSON.stringify(row)), "</inventario>"] : []),
  ].join("\n");

  const { text } = await completeOnce({ system, input, maxTokens: 2000, effort: "low", clients });
  const draft = text.trim().replace(/^"(.*)"$/s, "$1").trim();
  if (!draft) throw new Error("la IA devolvió un borrador vacío");
  return draft;
}
