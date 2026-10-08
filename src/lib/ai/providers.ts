import Anthropic from "@anthropic-ai/sdk";
import type * as Beta from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { AiConfig } from "./config";
import { AGENT_TOOLS } from "./tools";

/**
 * Cada proveedor guarda el historial en su propio formato de API. El ciclo del agente
 * (agent.ts) es el mismo para ambos; aquí solo se traducen solicitudes y respuestas.
 */
export type TranscriptFormat = "anthropic" | "openai";

/** Un mensaje del historial, en el formato del proveedor. Se guarda tal cual en AgentTranscript. */
export type TranscriptMessage = { role: string } & Record<string, unknown>;

export type ToolCall = { id: string; name: string; input: Record<string, unknown> };
export type ToolResult = { id: string; content: string; isError?: boolean };

export type Step = {
  /** Mensaje del asistente para agregar al historial; ausente si el modelo rechazó responder. */
  message?: TranscriptMessage;
  text: string;
  toolCalls: ToolCall[];
  /** El turno sigue en el servidor (pause_turn): hay que volver a llamar sin agregar nada. */
  paused?: boolean;
  /** Para el monitor de actividad: modelo que respondió, razonamiento visible y tokens. */
  model?: string;
  reasoning?: string;
  /** `cached`: tokens de entrada leídos de la caché de prompts (ya incluidos en `input`). */
  usage?: { input: number; output: number; cached?: number };
};

export interface Provider {
  format: TranscriptFormat;
  userTurn(text: string): TranscriptMessage;
  toolResults(results: ToolResult[]): TranscriptMessage[];
  assistantText(text: string): TranscriptMessage;
  step(system: string, messages: TranscriptMessage[]): Promise<Step>;
}

// Anthropic (API directa)

export type AnthropicClient = Pick<Anthropic, "beta">;

let anthropicDefault: Anthropic | null = null;

export function anthropicProvider(config: AiConfig, client?: AnthropicClient): Provider {
  return {
    format: "anthropic",
    userTurn: (text) => ({ role: "user", content: [{ type: "text", text }] }),
    toolResults: (results) => [
      {
        role: "user",
        content: results.map(
          (r): Beta.BetaToolResultBlockParam => ({
            type: "tool_result",
            tool_use_id: r.id,
            content: r.content,
            ...(r.isError ? { is_error: true } : {}),
          }),
        ),
      },
    ],
    assistantText: (text) => ({ role: "assistant", content: [{ type: "text", text }] }),
    async step(system, messages) {
      const api = client ?? (anthropicDefault ??= new Anthropic());
      const response = await api.beta.messages.create({
        model: config.model,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01", "thinking-binding-controls-2026-08-01"],
        fallbacks: "default",
        // Si cambian las instrucciones de la empresa, se descarta el razonamiento previo en vez de fallar.
        thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
        output_config: { effort: config.effort },
        cache_control: { type: "ephemeral" },
        system,
        tools: AGENT_TOOLS,
        messages: messages as unknown as Beta.BetaMessageParam[],
      });
      const usage = response.usage
        ? {
            input:
              (response.usage.input_tokens ?? 0) +
              (response.usage.cache_read_input_tokens ?? 0) +
              (response.usage.cache_creation_input_tokens ?? 0),
            output: response.usage.output_tokens ?? 0,
            cached: response.usage.cache_read_input_tokens ?? 0,
          }
        : undefined;
      const meta = { model: response.model, usage };
      if (response.stop_reason === "refusal") return { text: "", toolCalls: [], ...meta };
      const toolCalls =
        response.stop_reason === "tool_use"
          ? response.content
              .filter((b): b is Beta.BetaToolUseBlock => b.type === "tool_use")
              .map((b) => ({ id: b.id, name: b.name, input: b.input as Record<string, unknown> }))
          : [];
      return {
        message: { role: "assistant", content: response.content },
        text: response.content
          .filter((b): b is Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim(),
        toolCalls,
        paused: response.stop_reason === "pause_turn",
        reasoning:
          response.content
            .filter((b): b is Beta.BetaThinkingBlock => b.type === "thinking")
            .map((b) => b.thinking)
            .join("\n")
            .trim() || undefined,
        ...meta,
      };
    },
  };
}

// OpenRouter (API compatible con OpenAI chat completions)

export type ChatClient = { complete(body: Record<string, unknown>): Promise<ChatResponse> };

type ChatMessage = {
  role: string;
  content?: string | null;
  refusal?: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  reasoning_details?: unknown;
  reasoning?: string | null;
};

export type ChatResponse = {
  model?: string;
  choices?: { finish_reason: string | null; message: ChatMessage }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
  error?: { message?: string; code?: number | string };
};

export const OPENROUTER_URL = "https://openrouter.ai/api/v1";

export const openRouterClient: ChatClient = {
  async complete(body) {
    const res = await fetch(`${OPENROUTER_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "X-Title": "Bella CRM",
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as ChatResponse;
    if (!res.ok || json.error) {
      throw new Error(`OpenRouter ${res.status}: ${json.error?.message ?? res.statusText}`);
    }
    return json;
  },
};

const OPENAI_TOOLS = AGENT_TOOLS.map((t) => ({
  type: "function",
  function: { name: t.name, description: t.description, parameters: t.input_schema, strict: true },
}));

function parseArguments(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

const CACHE = { type: "ephemeral" } as const;

/**
 * Marca las instrucciones y el último mensaje para la caché de prompts. Los modelos de Anthropic y
 * Gemini en OpenRouter solo cachean con estas marcas; los demás cachean solos y las ignoran. Las
 * marcas van solo en la solicitud: el historial guardado no cambia.
 */
export function withCacheBreakpoints(system: string, messages: TranscriptMessage[]): TranscriptMessage[] {
  const last = messages.at(-1);
  const marked =
    last && typeof last.content === "string" && last.content
      ? [...messages.slice(0, -1), { ...last, content: [{ type: "text", text: last.content, cache_control: CACHE }] }]
      : messages;
  return [{ role: "system", content: [{ type: "text", text: system, cache_control: CACHE }] }, ...marked];
}

export function openRouterProvider(config: AiConfig, client: ChatClient = openRouterClient): Provider {
  return {
    format: "openai",
    userTurn: (text) => ({ role: "user", content: text }),
    toolResults: (results) =>
      results.map((r) => ({
        role: "tool",
        tool_call_id: r.id,
        content: r.isError ? `Error: ${r.content}` : r.content,
      })),
    assistantText: (text) => ({ role: "assistant", content: text }),
    async step(system, messages) {
      const response = await client.complete({
        model: config.model,
        max_tokens: 16000,
        reasoning: { effort: config.effort },
        tools: OPENAI_TOOLS,
        messages: withCacheBreakpoints(system, messages),
      });
      const choice = response.choices?.[0];
      if (!choice) throw new Error("OpenRouter no devolvió respuesta");
      const m = choice.message;
      const meta = {
        model: response.model,
        usage: response.usage
          ? {
              input: response.usage.prompt_tokens ?? 0,
              output: response.usage.completion_tokens ?? 0,
              cached: response.usage.prompt_tokens_details?.cached_tokens ?? 0,
            }
          : undefined,
      };
      if (choice.finish_reason === "content_filter" || m.refusal) return { text: "", toolCalls: [], ...meta };
      // Se guarda el mensaje completo, incluido reasoning_details, para preservar el razonamiento.
      const message: TranscriptMessage = { role: "assistant", content: m.content ?? "" };
      if (m.tool_calls?.length) message.tool_calls = m.tool_calls;
      if (m.reasoning_details) message.reasoning_details = m.reasoning_details;
      return {
        message,
        text: (m.content ?? "").trim(),
        toolCalls: (m.tool_calls ?? []).map((c) => ({
          id: c.id,
          name: c.function.name,
          input: parseArguments(c.function.arguments),
        })),
        reasoning: m.reasoning?.trim() || undefined,
        ...meta,
      };
    },
  };
}

export type ProviderClients = { anthropic?: AnthropicClient; openrouter?: ChatClient };

export function providerFor(config: AiConfig, clients: ProviderClients = {}): Provider {
  return config.provider === "anthropic"
    ? anthropicProvider(config, clients.anthropic)
    : openRouterProvider(config, clients.openrouter);
}
