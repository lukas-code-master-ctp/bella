import type { Message } from "@prisma/client";
import { toLocalInput } from "../dates";
import { db } from "../db";
import {
  agendaLine,
  describeDuration,
  formatChileDateTime,
  getFollowUpSettings,
  NO_FOLLOW_UP,
  scheduleAfterAiTurnTx,
  type FollowUpSettings,
} from "../domain/follow-ups";
import { fieldsForCrmState } from "../domain/fields";
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
    "- Las notas de voz del cliente te llegan transcritas: respóndelas con naturalidad, como si las " +
      "hubieras escuchado. La transcripción puede tener errores; si algo importante no se entiende, pregunta.",
    (knowledge?.length
      ? "- La base de conocimiento completa está al final, en <base_de_conocimiento>: úsala para " +
        "responder sobre la empresa (no necesitas search_knowledge). Consulta search_inventory "
      : "- Consulta search_knowledge antes de responder preguntas sobre la empresa, y search_inventory ") +
      "antes de mencionar cualquier producto, precio o stock. Si no encuentras el dato, dilo y " +
      "ofrece derivar a un ejecutivo; nunca lo inventes.",
    "- Mantén el CRM al día mientras conversas: mueve el lead de etapa cuando avance en el proceso " +
      "y etiqueta su producto de interés y nivel de interés en cuanto lo sepas. Cuando el cliente " +
      "entregue un dato que corresponde a un campo del cliente, guárdalo con set_contact_field.",
    "- Si el cliente pide que lo contacten más adelante o acuerdan hablar en una fecha, agéndalo " +
      "con schedule_follow_up. Si deja de responder, el sistema te pedirá un mensaje de seguimiento " +
      "con un bloque <seguimiento>.",
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

async function buildCrmState(leadId: string, now = new Date()) {
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
  const agenda = agendaLine(lead);
  return [
    "<crm_state>",
    `Fecha y hora actual: ${formatChileDateTime(now)} (hora de Chile; en formato de fecha: ${toLocalInput(now).replace("T", " ")})`,
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
    ...(agenda ? [agenda] : []),
    "</crm_state>",
  ].join("\n");
}

/** Texto del cliente tal como lo ve la IA. Las notas de voz llegan transcritas. */
function contactText(m: Message) {
  if (!m.mediaUrl) return `Cliente: ${m.body}`;
  const caption = m.body ? `\n${m.body}` : "";
  return m.transcript
    ? `Cliente (nota de voz, transcrita): ${m.transcript}${caption}`
    : `Cliente: [envió una nota de voz que no se pudo transcribir; pídele que la escriba]${caption}`;
}

function formatPending(messages: (Message & { user: { name: string } | null })[], assistantName: string) {
  return messages
    .map((m) =>
      m.author === "CONTACT"
        ? contactText(m)
        : m.author === "AI"
          ? `${assistantName} (tú): ${m.body}`
          : `Ejecutivo (${m.user?.name ?? "equipo"}): ${m.body}`,
    )
    .join("\n");
}

/** Turno de seguimiento: el cliente no responde y la IA le vuelve a escribir. */
export type FollowUpTurn = {
  /** Seguimientos automáticos ya enviados desde el último mensaje del cliente. */
  count: number;
  /** Motivo si la IA agendó este recontacto; null si es automático. */
  reason: string | null;
};

/** "sent": la IA escribió; "skipped": no había nada que hacer o la IA decidió no escribir. */
export type TurnOutcome = "sent" | "skipped";

const running = new Map<string, Promise<TurnOutcome>>();

/**
 * Hace que la IA responda los mensajes pendientes de un lead (o, con `followUp`, que le escriba
 * un seguimiento). Si ya hay una ejecución en curso para el mismo lead, espera a que termine.
 */
export async function runAgent(
  leadId: string,
  clients: ProviderClients = {},
  followUp?: FollowUpTurn,
): Promise<TurnOutcome> {
  while (running.has(leadId)) await running.get(leadId);
  const run = runAgentOnce(leadId, clients, followUp).finally(() => running.delete(leadId));
  running.set(leadId, run);
  return run;
}

function followUpBlock(f: FollowUpTurn, s: FollowUpSettings, silentMs: number) {
  return [
    "<seguimiento>",
    f.reason
      ? `Agendaste este recontacto: ${f.reason}.`
      : `El cliente no responde desde hace ${describeDuration(silentMs)}. ` +
        (f.count < s.delays.length
          ? `Este es el seguimiento ${f.count + 1} de ${s.delays.length}.`
          : "Es un seguimiento adicional que pidió el equipo."),
    "Escríbele un mensaje para retomar la conversación. " + s.instructions,
    "Si no corresponde escribirle (la conversación ya terminó, se despidió o pidió que no le escriban), " +
      `responde solo ${NO_FOLLOW_UP}.`,
    "</seguimiento>",
  ].join("\n");
}

async function runAgentOnce(leadId: string, clients: ProviderClients, followUp?: FollowUpTurn): Promise<TurnOutcome> {
  const startedAt = new Date();
  const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId }, include: { transcript: true, stage: true } });
  if (!lead.aiEnabled || lead.status !== "OPEN") return "skipped";

  const [settings, config, followUps] = await Promise.all([getAssistantSettings(), getAiConfig(), getFollowUpSettings()]);
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
  const unanswered = pending.some((m) => m.author === "CONTACT" && m.createdAt > transcript.syncedUntil);
  // Un turno normal necesita un mensaje nuevo del cliente; un seguimiento, que no haya ninguno.
  if (followUp ? unanswered : !unanswered) return "skipped";

  const history = switched ? [] : (transcript.messages as unknown as TranscriptMessage[]);
  const blocks = [await buildCrmState(leadId, startedAt)];
  if (pending.length) blocks.push(formatPending(pending, settings.assistantName));
  if (followUp) {
    const last = await db.message.findFirst({ where: { leadId }, orderBy: { createdAt: "desc" } });
    blocks.push(followUpBlock(followUp, followUps, startedAt.getTime() - (last?.createdAt ?? startedAt).getTime()));
  }
  const context = blocks.join("\n\n");
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
    // En un seguimiento que falló no se le escribe al cliente ni se pausa la IA.
    if (followUp && handedOff) {
      reply = NO_FOLLOW_UP;
      handedOff = false;
    }
    messages.push(provider.assistantText(reply));
  } else if (followUp && handedOff) {
    reply = NO_FOLLOW_UP;
    handedOff = false;
  }
  if (reply.trim() === NO_FOLLOW_UP) reply = "";
  const agendaChanged = trace.some((t) => t.type === "tool" && t.name === "schedule_follow_up" && !t.isError);

  const sent = await db.$transaction(async (tx) => {
    await tx.agentTranscript.update({
      where: { leadId },
      data: {
        format: provider.format,
        messages: messages as unknown as object,
        syncedUntil: pending.length ? pending[pending.length - 1].createdAt : transcript.syncedUntil,
      },
    });
    const message = reply ? await tx.message.create({ data: { leadId, author: "AI", body: reply } }) : null;
    if (followUp) {
      await tx.leadEvent.create({
        data: {
          leadId,
          type: message ? "FOLLOW_UP_SENT" : "FOLLOW_UP_SKIPPED",
          actor: "AI",
          reason: followUp.reason,
          data: followUp.reason ? {} : { number: followUp.count + 1, total: followUps.delays.length },
        },
      });
    }
    if (handedOff) {
      const current = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
      if (current.aiEnabled) {
        await tx.lead.update({ where: { id: leadId }, data: { aiEnabled: false } });
        await tx.leadEvent.create({
          data: { leadId, type: "AI_PAUSED", actor: "SYSTEM", reason: "La IA no pudo responder; requiere un ejecutivo" },
        });
      }
    }
    await scheduleAfterAiTurnTx(
      tx,
      leadId,
      {
        sentAt: message?.createdAt ?? new Date(),
        sent: Boolean(message),
        agendaChanged,
        ...(followUp ? { followUp: { count: followUp.count, scheduled: Boolean(followUp.reason) } } : {}),
      },
      followUps,
    );
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
          outcome: handedOff ? "fallback" : followUp ? "follow_up" : "reply",
          startedAt,
          durationMs: Date.now() - startedAt.getTime(),
        },
      })
      .catch((err) => console.error(`[agent] monitor de actividad, lead ${leadId}:`, err));
  }
  return sent ? "sent" : "skipped";
}
