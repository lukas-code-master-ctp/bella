import type { Message } from "@prisma/client";
import { db } from "../db";
import { getAssistantSettings, type AssistantSettings } from "../settings";
import { getAiConfig } from "./config";
import { providerFor, type ProviderClients, type ToolResult, type TranscriptMessage } from "./providers";
import { executeTool } from "./tools";

const MAX_STEPS = 10;

/** Respuesta al cliente cuando el modelo no puede continuar (rechazo o error). */
export const FALLBACK_REPLY =
  "Gracias por tu mensaje. Un ejecutivo de nuestro equipo te responderá en breve.";

export function buildSystemPrompt(s: AssistantSettings): string {
  return [
    `Eres ${s.assistantName}, asistente de ventas de ${s.companyName}. Conversas por chat con ` +
      "personas interesadas (leads) para resolver sus dudas, entender qué necesitan y llevarlas " +
      "hacia la compra, trabajando junto al equipo de ejecutivos de venta.",
    "",
    "Cómo trabajas:",
    "- Cada mensaje del cliente llega con un bloque <crm_state> que muestra la etapa actual del " +
      "lead, las etapas del funnel, sus etiquetas y el catálogo de etiquetas. El cliente no ve ese " +
      "bloque; no lo menciones.",
    "- Consulta search_knowledge antes de responder preguntas sobre la empresa, y search_inventory " +
      "antes de mencionar cualquier producto, precio o stock. Si no encuentras el dato, dilo y " +
      "ofrece derivar a un ejecutivo; nunca lo inventes.",
    "- Mantén el CRM al día mientras conversas: mueve el lead de etapa cuando avance en el proceso " +
      "y etiqueta su producto de interés y nivel de interés en cuanto lo sepas.",
    "- Usa handoff_to_human cuando el cliente pida hablar con una persona, quiera concretar la " +
      "compra, esté molesto, o necesite algo que no puedes resolver.",
    "- Tu respuesta final de cada turno es exactamente el mensaje que recibirá el cliente por chat: " +
      "texto plano, sin markdown ni encabezados.",
    "",
    "Instrucciones de la empresa:",
    s.instructions,
  ].join("\n");
}

async function buildCrmState(leadId: string) {
  const [lead, stages, catalog] = await Promise.all([
    db.lead.findUniqueOrThrow({
      where: { id: leadId },
      include: { stage: true, contact: { include: { tags: { include: { tag: true } } } } },
    }),
    db.stage.findMany({ orderBy: { position: "asc" } }),
    db.tag.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] }),
  ]);
  const byCategory = new Map<string, string[]>();
  for (const t of catalog) byCategory.set(t.category, [...(byCategory.get(t.category) ?? []), t.name]);
  const currentTags = lead.contact.tags.map((ct) => `${ct.tag.category}: ${ct.tag.name}`);
  return [
    "<crm_state>",
    `Contacto: ${lead.contact.name}`,
    `Teléfono: ${lead.contact.phone ?? "sin registrar"}`,
    `Correo: ${lead.contact.email ?? "sin registrar"}`,
    `Etapa actual: ${lead.stage.name}`,
    `Etapas del funnel (en orden): ${stages
      .map((s) => (s.requiresHuman ? `${s.name} [atención humana]` : s.name))
      .join(" → ")}`,
    `Etiquetas actuales: ${currentTags.length ? currentTags.join(", ") : "ninguna"}`,
    `Catálogo de etiquetas: ${[...byCategory].map(([c, names]) => `${c}: ${names.join(" | ")}`).join("; ") || "vacío"}`,
    "</crm_state>",
  ].join("\n");
}

function formatPending(messages: (Message & { user: { name: string } | null })[], assistantName: string) {
  return messages
    .map((m) =>
      m.author === "CONTACT"
        ? `Cliente: ${m.body}`
        : m.author === "AI"
          ? `${assistantName} (tú): ${m.body}`
          : `Ejecutivo (${m.user?.name ?? "equipo"}): ${m.body}`,
    )
    .join("\n");
}

const running = new Map<string, Promise<void>>();

/**
 * Hace que la IA responda los mensajes pendientes de un lead. Si ya hay una ejecución
 * en curso para el mismo lead, espera a que termine y vuelve a revisar.
 */
export async function runAgent(leadId: string, clients: ProviderClients = {}): Promise<void> {
  while (running.has(leadId)) await running.get(leadId);
  const run = runAgentOnce(leadId, clients).finally(() => running.delete(leadId));
  running.set(leadId, run);
  return run;
}

async function runAgentOnce(leadId: string, clients: ProviderClients): Promise<void> {
  const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId }, include: { transcript: true } });
  if (!lead.aiEnabled || lead.status !== "OPEN") return;

  const [settings, config] = await Promise.all([getAssistantSettings(), getAiConfig()]);
  const provider = providerFor(config, clients);

  const transcript =
    lead.transcript ??
    (await db.agentTranscript.create({ data: { leadId, format: provider.format, syncedUntil: new Date(0) } }));
  // Si se cambió de proveedor, su historial no sirve: se parte uno nuevo en el formato del
  // proveedor actual, con toda la conversación visible (incluidas las respuestas de la IA).
  const switched = transcript.format !== provider.format;

  const pending = await db.message.findMany({
    where: switched
      ? { leadId }
      : { leadId, author: { in: ["CONTACT", "USER"] }, createdAt: { gt: transcript.syncedUntil } },
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (!pending.some((m) => m.author === "CONTACT" && m.createdAt > transcript.syncedUntil)) return;

  const history = switched ? [] : (transcript.messages as unknown as TranscriptMessage[]);
  const messages: TranscriptMessage[] = [
    ...history,
    provider.userTurn(`${await buildCrmState(leadId)}\n\n${formatPending(pending, settings.assistantName)}`),
  ];
  const system = buildSystemPrompt(settings);

  let reply = "";
  let handedOff = false;
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const result = await provider.step(system, messages);
      if (!result.message) {
        // Rechazo: no guardamos el turno rechazado; se cierra con la respuesta de respaldo más abajo.
        reply = FALLBACK_REPLY;
        handedOff = true;
        break;
      }
      messages.push(result.message);
      if (result.paused) continue;
      if (!result.toolCalls.length) {
        reply = result.text;
        break;
      }

      const results: ToolResult[] = [];
      for (const call of result.toolCalls) {
        const outcome = await executeTool(leadId, call.name, call.input).catch((err: unknown) => ({
          isError: true,
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        }));
        results.push({ id: call.id, ...outcome });
      }
      messages.push(...provider.toolResults(results));
    }
  } catch (err) {
    console.error(`[agent] lead ${leadId}:`, err);
    reply = FALLBACK_REPLY;
    handedOff = true;
  }

  // Si el turno no terminó con una respuesta del asistente (rechazo, error o se agotaron
  // los pasos), lo cerramos con la respuesta de respaldo para que el historial siga válido.
  if (messages[messages.length - 1].role !== "assistant") {
    if (!reply) {
      reply = FALLBACK_REPLY;
      handedOff = true;
    }
    messages.push(provider.assistantText(reply));
  }

  await db.$transaction(async (tx) => {
    await tx.agentTranscript.update({
      where: { leadId },
      data: {
        format: provider.format,
        messages: messages as unknown as object,
        syncedUntil: pending[pending.length - 1].createdAt,
      },
    });
    if (reply) await tx.message.create({ data: { leadId, author: "AI", body: reply } });
    if (handedOff) {
      const current = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
      if (current.aiEnabled) {
        await tx.lead.update({ where: { id: leadId }, data: { aiEnabled: false } });
        await tx.leadEvent.create({
          data: { leadId, type: "AI_PAUSED", actor: "SYSTEM", reason: "La IA no pudo responder; requiere un ejecutivo" },
        });
      }
    }
  });
}
