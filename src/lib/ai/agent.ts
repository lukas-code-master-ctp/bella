import type { Message } from "@prisma/client";
import { db } from "../db";
import { fieldsForCrmState } from "../domain/fields";
import { formatLocal, toLocalInput } from "../dates";
import { knowledgeForPrompt } from "../knowledge";
import { getAssistantSettings, type AssistantSettings } from "../settings";
import { getAiConfig } from "./config";
import { providerFor, type ProviderClients, type ToolResult, type TranscriptMessage } from "./providers";
import { executeTool } from "./tools";
import type { TraceStep } from "./trace";

const MAX_STEPS = 10;

/** Respuesta al cliente cuando el modelo no puede continuar (rechazo o error). */
export const FALLBACK_REPLY =
  "Gracias por tu mensaje. Un ejecutivo de nuestro equipo te responderá en breve.";

type KnowledgeDoc = { title: string; content: string };

/**
 * Las instrucciones son iguales en todos los turnos (quedan en caché). Con `knowledge`, la base
 * de conocimiento va completa al final; sin ella, la asistente la consulta con search_knowledge.
 */
export function buildSystemPrompt(s: AssistantSettings, knowledge: KnowledgeDoc[] | null = null): string {
  const lines = [
    `Eres ${s.assistantName}, asistente de ventas de ${s.companyName}. Conversas por chat con ` +
      "personas interesadas (leads) para resolver sus dudas, entender qué necesitan y llevarlas " +
      "hacia la compra, trabajando junto al equipo de ejecutivos de venta.",
    "",
    "Cómo trabajas:",
    "- Cada mensaje del cliente llega con un bloque <crm_state> que muestra la etapa actual del " +
      "lead, las etapas del funnel, sus etiquetas, el catálogo de etiquetas y los campos del cliente. El cliente no ve ese " +
      "bloque; no lo menciones.",
    (knowledge?.length
      ? "- La base de conocimiento completa está al final, en <base_de_conocimiento>: úsala para " +
        "responder sobre la empresa (no necesitas search_knowledge). Consulta search_inventory "
      : "- Consulta search_knowledge antes de responder preguntas sobre la empresa, y search_inventory ") +
      "antes de mencionar cualquier producto, precio o stock. Si no encuentras el dato, dilo y " +
      "ofrece derivar a un ejecutivo; nunca lo inventes.",
    "- Mantén el CRM al día mientras conversas: mueve el lead de etapa cuando avance en el proceso " +
      "y etiqueta su producto de interés y nivel de interés en cuanto lo sepas. Cuando el cliente " +
      "entregue un dato que corresponde a un campo del cliente, guárdalo con set_contact_field.",
    "- Cuando una persona del equipo deba hacer algo con plazo (llamar, enviar documentos, " +
      "confirmar una visita), créale una tarea con create_task. Revisa en <crm_state> las tareas " +
      "pendientes para no repetirlas.",
    "- Usa handoff_to_human cuando el cliente pida hablar con una persona, quiera concretar la " +
      "compra, esté molesto, o necesite algo que no puedes resolver.",
    "- Tu respuesta final de cada turno es exactamente el mensaje que recibirá el cliente por chat: " +
      "texto plano, sin markdown ni encabezados.",
    "",
    "Instrucciones de la empresa:",
    s.instructions,
  ];
  if (knowledge?.length) {
    lines.push(
      "",
      "<base_de_conocimiento>",
      ...knowledge.map((d) => `<documento titulo="${d.title}">\n${d.content}\n</documento>`),
      "</base_de_conocimiento>",
    );
  }
  return lines.join("\n");
}

async function buildCrmState(leadId: string) {
  const lead = await db.lead.findUniqueOrThrow({
    where: { id: leadId },
    include: {
      stage: true,
      contact: { include: { tags: { include: { tag: true } } } },
      tasks: { where: { completedAt: null }, orderBy: { dueAt: "asc" } },
    },
  });
  const [stages, catalog, fields] = await Promise.all([
    db.stage.findMany({ orderBy: { position: "asc" } }),
    db.tag.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] }),
    fieldsForCrmState(lead.contactId),
  ]);
  const byCategory = new Map<string, string[]>();
  for (const t of catalog) byCategory.set(t.category, [...(byCategory.get(t.category) ?? []), t.name]);
  const currentTags = lead.contact.tags.map((ct) => `${ct.tag.category}: ${ct.tag.name}`);
  const now = new Date();
  return [
    "<crm_state>",
    `Fecha y hora actual (Chile): ${formatLocal(now)} (${toLocalInput(now).replace("T", " ")})`,
    `Contacto: ${lead.contact.name}`,
    `Teléfono: ${lead.contact.phone ?? "sin registrar"}`,
    `Correo: ${lead.contact.email ?? "sin registrar"}`,
    `Etapa actual: ${lead.stage.name}`,
    `Etapas del funnel (en orden): ${stages
      .map((s) => (s.requiresHuman ? `${s.name} [atención humana]` : s.name))
      .join(" → ")}`,
    `Etiquetas actuales: ${currentTags.length ? currentTags.join(", ") : "ninguna"}`,
    `Catálogo de etiquetas: ${[...byCategory].map(([c, names]) => `${c}: ${names.join(" | ")}`).join("; ") || "vacío"}`,
    ...fields,
    `Tareas pendientes del equipo: ${
      lead.tasks.length
        ? lead.tasks.map((t) => `${t.title} (vence ${toLocalInput(t.dueAt).replace("T", " ")})`).join("; ")
        : "ninguna"
    }`,
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
  const startedAt = new Date();
  const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId }, include: { transcript: true, stage: true } });
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
  const context = `${await buildCrmState(leadId)}\n\n${formatPending(pending, settings.assistantName)}`;
  const messages: TranscriptMessage[] = [...history, provider.userTurn(context)];
  const system = buildSystemPrompt(settings, await knowledgeForPrompt());

  // Línea de tiempo del turno para el monitor de actividad.
  const trace: TraceStep[] = [];
  let reply = "";
  let handedOff = false;
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const stepStart = Date.now();
      const result = await provider.step(system, messages);
      trace.push({
        type: "model",
        durationMs: Date.now() - stepStart,
        ...(result.model ? { model: result.model } : {}),
        ...(result.text ? { text: result.text } : {}),
        ...(result.reasoning ? { reasoning: result.reasoning } : {}),
        ...(result.usage ? { usage: result.usage } : {}),
      });
      if (!result.message) {
        trace.push({ type: "refusal" });
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
        const toolStart = Date.now();
        const outcome = await executeTool(leadId, call.name, call.input).catch((err: unknown) => ({
          isError: true,
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        }));
        results.push({ id: call.id, ...outcome });
        trace.push({
          type: "tool",
          name: call.name,
          input: call.input,
          result: outcome.content,
          ...(outcome.isError ? { isError: true } : {}),
          durationMs: Date.now() - toolStart,
        });
      }
      messages.push(...provider.toolResults(results));
    }
  } catch (err) {
    console.error(`[agent] lead ${leadId}:`, err);
    trace.push({ type: "error", message: err instanceof Error ? err.message : String(err) });
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

  const sent = await db.$transaction(async (tx) => {
    await tx.agentTranscript.update({
      where: { leadId },
      data: {
        format: provider.format,
        messages: messages as unknown as object,
        syncedUntil: pending[pending.length - 1].createdAt,
      },
    });
    const message = reply ? await tx.message.create({ data: { leadId, author: "AI", body: reply } }) : null;
    if (handedOff) {
      const current = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
      if (current.aiEnabled) {
        await tx.lead.update({ where: { id: leadId }, data: { aiEnabled: false } });
        await tx.leadEvent.create({
          data: { leadId, type: "AI_PAUSED", actor: "SYSTEM", reason: "La IA no pudo responder; requiere un ejecutivo" },
        });
      }
    }
    return message;
  });

  // Fuera de la transacción: si falla el registro del monitor, la respuesta igual queda guardada.
  if (sent) {
    await db.agentRun
      .create({
        data: {
          leadId,
          messageId: sent.id,
          provider: config.provider,
          model: config.model,
          effort: config.effort,
          stageName: lead.stage.name,
          system,
          context,
          steps: trace as unknown as object,
          outcome: handedOff ? "fallback" : "reply",
          startedAt,
          durationMs: Date.now() - startedAt.getTime(),
        },
      })
      .catch((err) => console.error(`[agent] monitor de actividad, lead ${leadId}:`, err));
  }
}
