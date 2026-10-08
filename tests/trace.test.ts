import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createLead } from "@/lib/domain/leads";
import { setSetting } from "@/lib/settings";
import { FALLBACK_REPLY, runAgent } from "@/lib/ai/agent";
import type { AiConfig } from "@/lib/ai/config";
import type { AnthropicClient, ChatClient, ChatResponse } from "@/lib/ai/providers";
import { loadRunView, type TraceStep } from "@/lib/ai/trace";
import { seedFunnel } from "./factories";

function fakeAnthropic(script: { stop_reason: string; content: object[] }[]) {
  const client = {
    beta: {
      messages: {
        create: async () => {
          const next = script.shift();
          if (!next) throw new Error("Sin respuestas guionadas");
          return {
            id: "msg",
            type: "message",
            role: "assistant",
            model: "claude-servido",
            usage: { input_tokens: 100, cache_read_input_tokens: 50, output_tokens: 20 },
            ...next,
          };
        },
      },
    },
  } as unknown as AnthropicClient;
  return { anthropic: client };
}

function fakeOpenRouter(script: NonNullable<ChatResponse["choices"]>[]) {
  const client: ChatClient = {
    complete: async () => {
      const choices = script.shift();
      if (!choices) throw new Error("Sin respuestas guionadas");
      return { model: "proveedor/servido", choices, usage: { prompt_tokens: 10, completion_tokens: 5 } };
    },
  };
  return { openrouter: client };
}

const toolUse = (id: string, name: string, input: object) => ({ type: "tool_use", id, name, input });
const text = (t: string) => ({ type: "text", text: t });

async function lastAiMessage(leadId: string) {
  return db.message.findFirstOrThrow({ where: { leadId, author: "AI" }, orderBy: { createdAt: "desc" } });
}

describe("monitor de actividad", () => {
  beforeEach(() => setSetting<AiConfig>("ai", { provider: "anthropic", model: "claude-configurado", effort: "high" }));

  it("guarda contexto, modelo, herramientas con argumentos y resultado de cada respuesta", async () => {
    await seedFunnel();
    await db.inventoryItem.create({
      data: { rowNumber: 2, data: { Modelo: "Honda CB190" }, searchText: "honda cb190 moto" },
    });
    const lead = await createLead({ name: "Pedro", channel: "SIMULATOR" });
    await db.message.create({ data: { leadId: lead.id, author: "CONTACT", body: "¿Tienen la CB190?" } });

    await runAgent(
      lead.id,
      fakeAnthropic([
        {
          stop_reason: "tool_use",
          content: [
            { type: "thinking", thinking: "Debo revisar el inventario", signature: "s" },
            toolUse("t1", "search_inventory", { query: "cb190" }),
            toolUse("t2", "move_stage", { stage: "Inexistente", reason: "x" }),
          ],
        },
        { stop_reason: "end_turn", content: [text("¡Sí, la tenemos!")] },
      ]),
    );

    const message = await lastAiMessage(lead.id);
    const run = await loadRunView(lead.id, message.id);
    expect(run).toMatchObject({
      legacy: false,
      provider: "anthropic",
      model: "claude-configurado",
      effort: "high",
      stageName: "Nuevo",
      outcome: "reply",
    });
    expect(run!.context).toContain("Cliente: ¿Tienen la CB190?");
    expect(run!.context).toContain("<crm_state>");
    expect(run!.system).toContain("Instrucciones de la empresa");

    const steps = run!.steps;
    expect(steps.map((s) => (s.type === "tool" ? s.name : s.type))).toEqual([
      "model",
      "search_inventory",
      "move_stage",
      "model",
    ]);
    expect(steps[0]).toMatchObject({
      model: "claude-servido",
      reasoning: "Debo revisar el inventario",
      usage: { input: 150, output: 20 },
    });
    expect(steps[1]).toMatchObject({ input: { query: "cb190" } });
    expect((steps[1] as Extract<TraceStep, { type: "tool" }>).result).toContain("Honda CB190");
    expect(steps[2]).toMatchObject({ isError: true });
    expect(steps[3]).toMatchObject({ text: "¡Sí, la tenemos!" });
  });

  it("registra el error cuando la IA no puede responder", async () => {
    await seedFunnel();
    const lead = await createLead({ name: "Pedro", channel: "SIMULATOR" });
    await db.message.create({ data: { leadId: lead.id, author: "CONTACT", body: "Hola" } });
    await runAgent(lead.id, fakeAnthropic([]));

    const message = await lastAiMessage(lead.id);
    expect(message.body).toBe(FALLBACK_REPLY);
    const run = await loadRunView(lead.id, message.id);
    expect(run?.outcome).toBe("fallback");
    expect(run?.steps).toEqual([{ type: "error", message: "Sin respuestas guionadas" }]);
  });

  it("reconstruye desde el historial los mensajes anteriores al monitor (OpenRouter)", async () => {
    await setSetting<AiConfig>("ai", { provider: "openrouter", model: "x", effort: "medium" });
    await seedFunnel();
    const lead = await createLead({ name: "Pedro", channel: "SIMULATOR" });
    await db.message.create({ data: { leadId: lead.id, author: "CONTACT", body: "Hola" } });
    await runAgent(
      lead.id,
      fakeOpenRouter([
        [
          {
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                { id: "c1", type: "function", function: { name: "search_knowledge", arguments: '{"query":"horario"}' } },
              ],
            },
          },
        ],
        [{ finish_reason: "stop", message: { role: "assistant", content: "¡Hola!" } }],
      ]),
    );
    const message = await lastAiMessage(lead.id);
    await db.agentRun.deleteMany();

    const run = await loadRunView(lead.id, message.id);
    expect(run?.legacy).toBe(true);
    expect(run?.context).toContain("Cliente: Hola");
    expect(run?.steps).toEqual([
      { type: "model" },
      expect.objectContaining({ type: "tool", name: "search_knowledge", input: { query: "horario" } }),
      { type: "model", text: "¡Hola!" },
    ]);
  });

  it("no muestra mensajes de otro lead", async () => {
    await seedFunnel();
    const a = await createLead({ name: "A", channel: "SIMULATOR" });
    const b = await createLead({ name: "B", channel: "SIMULATOR" });
    await db.message.create({ data: { leadId: a.id, author: "CONTACT", body: "Hola" } });
    await runAgent(a.id, fakeAnthropic([{ stop_reason: "end_turn", content: [text("¡Hola!")] }]));
    const message = await lastAiMessage(a.id);
    expect(await loadRunView(b.id, message.id)).toBeNull();
  });
});
