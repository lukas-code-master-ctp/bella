import { db } from "../db";
import type { TranscriptMessage } from "./providers";

/**
 * Monitor de actividad: qué hizo la IA para construir cada respuesta. Cada turno guarda su
 * línea de tiempo en AgentRun; para respuestas anteriores a eso se reconstruye lo posible
 * (herramientas y resultados) desde el historial de AgentTranscript, sin modificarlo.
 */
export type TraceStep =
  | {
      type: "model";
      /** Modelo que respondió (puede diferir del configurado si hubo respaldo). */
      model?: string;
      durationMs?: number;
      text?: string;
      reasoning?: string;
      usage?: { input: number; output: number };
    }
  | {
      type: "tool";
      name: string;
      input: Record<string, unknown>;
      result: string;
      isError?: boolean;
      durationMs?: number;
    }
  | { type: "refusal" }
  | { type: "error"; message: string };

export type RunView = {
  /** true si se reconstruyó desde el historial (sin modelo, etapa ni tiempos). */
  legacy: boolean;
  provider?: string;
  model?: string;
  effort?: string;
  stageName?: string;
  startedAt?: string;
  durationMs?: number;
  outcome?: string;
  system?: string;
  context: string;
  steps: TraceStep[];
};

/** Detalle de cómo se construyó un mensaje de la IA, o null si no hay registro. */
export async function loadRunView(leadId: string, messageId: string): Promise<RunView | null> {
  const message = await db.message.findFirst({ where: { id: messageId, leadId, author: "AI" } });
  if (!message) return null;
  const run = await db.agentRun.findUnique({ where: { messageId } }).catch(() => null);
  if (run) {
    return {
      legacy: false,
      provider: run.provider,
      model: run.model,
      effort: run.effort,
      stageName: run.stageName,
      startedAt: run.startedAt.toISOString(),
      durationMs: run.durationMs,
      outcome: run.outcome,
      system: run.system,
      context: run.context,
      steps: run.steps as unknown as TraceStep[],
    };
  }

  const transcript = await db.agentTranscript.findUnique({ where: { leadId } });
  if (!transcript) return null;
  // Si el mismo texto se respondió más de una vez, se toma el turno en la misma posición.
  const sameBody = await db.message.findMany({
    where: { leadId, author: "AI", body: message.body },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const nth = sameBody.findIndex((m) => m.id === messageId);
  const turns = turnsFromTranscript(transcript.format, transcript.messages as unknown as TranscriptMessage[]);
  const turn = turns.filter((t) => t.reply === message.body.trim())[nth];
  return turn ? { legacy: true, context: turn.context, steps: turn.steps } : null;
}

type Turn = { context: string; steps: TraceStep[]; reply: string };

type Block = { type: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; is_error?: boolean };

const asText = (content: unknown) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((b: Block) => b.text ?? "").join("\n")
      : "";

/** Divide el historial en turnos (un mensaje del usuario hasta la respuesta final). */
export function turnsFromTranscript(format: string, messages: TranscriptMessage[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn | null = null;
  const pending = new Map<string, Extract<TraceStep, { type: "tool" }>>();

  for (const m of messages) {
    if (format === "anthropic") {
      const blocks = (Array.isArray(m.content) ? m.content : []) as Block[];
      if (m.role === "user") {
        const results = blocks.filter((b) => b.type === "tool_result");
        if (!results.length) {
          current = { context: asText(blocks), steps: [], reply: "" };
          turns.push(current);
          continue;
        }
        for (const r of results) {
          const step = pending.get(r.tool_use_id ?? "");
          if (step) Object.assign(step, { result: asText(r.content), ...(r.is_error ? { isError: true } : {}) });
        }
      } else if (current) {
        const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
        const reasoning = blocks.filter((b) => b.type === "thinking").map((b) => b.thinking).join("\n").trim();
        current.steps.push({ type: "model", ...(text ? { text } : {}), ...(reasoning ? { reasoning } : {}) });
        for (const b of blocks.filter((b) => b.type === "tool_use")) {
          const step = { type: "tool" as const, name: b.name ?? "", input: (b.input ?? {}) as Record<string, unknown>, result: "" };
          pending.set(b.id ?? "", step);
          current.steps.push(step);
        }
        current.reply = text;
      }
    } else {
      if (m.role === "user") {
        current = { context: asText(m.content), steps: [], reply: "" };
        turns.push(current);
      } else if (m.role === "tool") {
        const step = pending.get(String(m.tool_call_id ?? ""));
        const result = asText(m.content);
        if (step) Object.assign(step, { result, ...(result.startsWith("Error: ") ? { isError: true } : {}) });
      } else if (m.role === "assistant" && current) {
        const text = asText(m.content).trim();
        current.steps.push({ type: "model", ...(text ? { text } : {}) });
        const calls = (m.tool_calls ?? []) as { id: string; function: { name: string; arguments: string } }[];
        for (const c of calls) {
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(c.function.arguments || "{}");
          } catch {}
          const step = { type: "tool" as const, name: c.function.name, input, result: "" };
          pending.set(c.id, step);
          current.steps.push(step);
        }
        current.reply = text;
      }
    }
  }
  return turns;
}
