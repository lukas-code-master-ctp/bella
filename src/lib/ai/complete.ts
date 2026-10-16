import { getAiConfig } from "./config";
import { defaultAnthropic, openRouterClient, type ProviderClients } from "./providers";

/**
 * Una sola llamada al modelo principal (el de Configuración), sin herramientas ni historial:
 * para informes que la IA arma de una vez (resumen semanal, recomendaciones de campañas).
 * Devuelve el texto y el modelo usado.
 */
export async function completeOnce(
  {
    system,
    input,
    maxTokens = 3000,
    effort,
    clients = {},
  }: {
    system: string;
    input: string;
    maxTokens?: number;
    /** Razonamiento en OpenRouter (cuenta dentro de maxTokens); sin valor, el del modelo. */
    effort?: "low" | "medium" | "high";
    clients?: ProviderClients;
  },
): Promise<{ text: string; model: string }> {
  const config = await getAiConfig();
  if (config.provider === "anthropic") {
    const api = clients.anthropic ?? (await defaultAnthropic());
    const response = await api.beta.messages.create({
      model: config.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: input }],
    });
    return { text: response.content.map((b) => (b.type === "text" ? b.text : "")).join(""), model: config.model };
  }
  const response = await (clients.openrouter ?? openRouterClient).complete({
    model: config.model,
    max_tokens: maxTokens,
    ...(effort ? { reasoning: { effort } } : {}),
    messages: [
      { role: "system", content: system },
      { role: "user", content: input },
    ],
  });
  return { text: response.choices?.[0]?.message.content ?? "", model: config.model };
}

/** El objeto JSON dentro de la respuesta (aunque venga entre ```json o con texto alrededor). */
export function jsonIn(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}
