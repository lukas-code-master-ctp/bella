import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createLead } from "@/lib/domain/leads";
import { setSetting } from "@/lib/settings";
import { FALLBACK_REPLY, runAgent } from "@/lib/ai/agent";
import type { AiConfig } from "@/lib/ai/config";
import type { AnthropicClient, ChatClient, ChatResponse } from "@/lib/ai/providers";
import { executive, seedFunnel } from "./factories";

type Scripted = { stop_reason: string; content: object[] };

async function useProvider(provider: AiConfig["provider"], model = "modelo-x") {
  await setSetting<AiConfig>("ai", { provider, model, effort: "medium" });
}

/** Cliente falso de Anthropic que devuelve respuestas guionadas y registra las solicitudes. */
function fakeAnthropic(script: Scripted[]) {
  const requests: { messages: { role: string; content: unknown }[] }[] = [];
  const client = {
    beta: {
      messages: {
        create: async (req: (typeof requests)[number]) => {
          requests.push(structuredClone(req));
          const next = script.shift();
          if (!next) throw new Error("Sin respuestas guionadas");
          return { id: "msg", type: "message", role: "assistant", model: "x", usage: {}, ...next };
        },
      },
    },
  } as unknown as AnthropicClient;
  return { client: { anthropic: client }, requests };
}

const toolUse = (id: string, name: string, input: object) => ({ type: "tool_use", id, name, input });
const text = (t: string) => ({ type: "text", text: t });

async function inbound(leadId: string, body: string) {
  await db.message.create({ data: { leadId, author: "CONTACT", body } });
}

describe("asistente IA (Anthropic)", () => {
  beforeEach(() => useProvider("anthropic"));

  it("guarda el nombre y el correo que da el cliente, y ve su teléfono", async () => {
    await seedFunnel();
    const lead = await createLead({ name: "+56911112222", channel: "WHATSAPP", phone: "+56911112222" });
    await inbound(lead.id, "Soy Ana Pérez, mi correo es Ana@Mail.cl");

    const { client, requests } = fakeAnthropic([
      {
        stop_reason: "tool_use",
        content: [toolUse("t1", "update_contact", { name: "Ana Pérez", email: "Ana@Mail.cl" })],
      },
      { stop_reason: "end_turn", content: [text("¡Gracias, Ana!")] },
    ]);
    await runAgent(lead.id, client);

    const firstTurn = requests[0].messages[0].content as { text: string }[];
    expect(firstTurn[0].text).toContain("Teléfono: +56911112222");
    const contact = await db.contact.findFirstOrThrow();
    expect([contact.name, contact.email]).toEqual(["Ana Pérez", "ana@mail.cl"]);
  });

  it("busca inventario, etiqueta, mueve de etapa y responde al cliente", async () => {
    await seedFunnel();
    await db.tag.create({ data: { category: "Producto", name: "Motos" } });
    await db.inventoryItem.create({
      data: { rowNumber: 2, data: { Modelo: "Honda CB190", Precio: "2.490.000" }, searchText: "honda cb190 2490000 moto" },
    });
    const lead = await createLead({ name: "Pedro", channel: "SIMULATOR" });
    await inbound(lead.id, "Hola, ¿tienen la Honda CB190?");

    const { client, requests } = fakeAnthropic([
      { stop_reason: "tool_use", content: [toolUse("t1", "search_inventory", { query: "honda cb190" })] },
      {
        stop_reason: "tool_use",
        content: [
          toolUse("t2", "tag_contact", { category: "producto", tag: "motos", reason: "pregunta por moto" }),
          toolUse("t3", "move_stage", { stage: "Calificado", reason: "producto definido" }),
        ],
      },
      { stop_reason: "end_turn", content: [text("¡Sí! La Honda CB190 está a $2.490.000.")] },
    ]);
    await runAgent(lead.id, client);

    // El resultado de inventario llega a la IA.
    const toolResult = requests[1].messages.at(-1)!.content as { content: string }[];
    expect(toolResult[0].content).toContain("Honda CB190");
    // El estado del CRM viaja junto al mensaje del cliente.
    const firstTurn = requests[0].messages[0].content as { text: string }[];
    expect(firstTurn[0].text).toContain("Etapa actual: Nuevo");
    expect(firstTurn[0].text).toContain("Cliente: Hola, ¿tienen la Honda CB190?");

    const updated = await db.lead.findUniqueOrThrow({
      where: { id: lead.id },
      include: { stage: true, contact: { include: { tags: { include: { tag: true } } } }, messages: true },
    });
    expect(updated.stage.name).toBe("Calificado");
    expect(updated.contact.tags.map((t) => t.tag.name)).toEqual(["Motos"]);
    expect(updated.messages.filter((m) => m.author === "AI").map((m) => m.body)).toEqual([
      "¡Sí! La Honda CB190 está a $2.490.000.",
    ]);
  });

  it("solo agrega al historial: el segundo turno reenvía el primero intacto", async () => {
    await seedFunnel();
    const lead = await createLead({ name: "Pedro", channel: "SIMULATOR" });
    await inbound(lead.id, "Hola");
    const first = fakeAnthropic([{ stop_reason: "end_turn", content: [text("¡Hola! ¿En qué te ayudo?")] }]);
    await runAgent(lead.id, first.client);

    await inbound(lead.id, "Busco una moto");
    const second = fakeAnthropic([{ stop_reason: "end_turn", content: [text("¿Para ciudad o carretera?")] }]);
    await runAgent(lead.id, second.client);

    const sent = second.requests[0].messages;
    expect(sent.slice(0, 2)).toEqual([...first.requests[0].messages, { role: "assistant", content: [text("¡Hola! ¿En qué te ayudo?")] }]);
    expect(sent).toHaveLength(3);
    expect((sent[2].content as { text: string }[])[0].text).toContain("Cliente: Busco una moto");
  });

  it("derivar a humano pausa la IA y asigna un ejecutivo", async () => {
    await seedFunnel();
    const ana = await executive("Ana");
    const lead = await createLead({ name: "Pedro", channel: "SIMULATOR" });
    await inbound(lead.id, "Quiero hablar con una persona");
    const { client } = fakeAnthropic([
      { stop_reason: "tool_use", content: [toolUse("t1", "handoff_to_human", { reason: "lo pidió" })] },
      { stop_reason: "end_turn", content: [text("Te contacto con un ejecutivo.")] },
    ]);
    await runAgent(lead.id, client);

    const updated = await db.lead.findUniqueOrThrow({ where: { id: lead.id }, include: { stage: true } });
    expect(updated).toMatchObject({ aiEnabled: false, assigneeId: ana.id });
    expect(updated.stage.name).toBe("Atención humana");

    // Con la IA pausada, un nuevo mensaje no dispara otra respuesta.
    await inbound(lead.id, "¿Hola?");
    const idle = fakeAnthropic([]);
    await runAgent(lead.id, idle.client);
    expect(idle.requests).toHaveLength(0);
  });

  it("si el modelo rechaza, responde el mensaje de respaldo y pausa la IA", async () => {
    await seedFunnel();
    const lead = await createLead({ name: "Pedro", channel: "SIMULATOR" });
    await inbound(lead.id, "Hola");
    const { client } = fakeAnthropic([{ stop_reason: "refusal", content: [] }]);
    await runAgent(lead.id, client);

    const updated = await db.lead.findUniqueOrThrow({ where: { id: lead.id }, include: { messages: true, transcript: true } });
    expect(updated.aiEnabled).toBe(false);
    expect(updated.messages.at(-1)?.body).toBe(FALLBACK_REPLY);
    const transcript = updated.transcript!.messages as { role: string }[];
    expect(transcript.at(-1)?.role).toBe("assistant");
  });

  it("una herramienta con datos inválidos devuelve error a la IA sin romper la conversación", async () => {
    await seedFunnel();
    const lead = await createLead({ name: "Pedro", channel: "SIMULATOR" });
    await inbound(lead.id, "Hola");
    const { client, requests } = fakeAnthropic([
      { stop_reason: "tool_use", content: [toolUse("t1", "move_stage", { stage: "Inexistente", reason: "x" })] },
      { stop_reason: "end_turn", content: [text("¡Hola!")] },
    ]);
    await runAgent(lead.id, client);
    const result = (requests[1].messages.at(-1)!.content as { is_error?: boolean; content: string }[])[0];
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Etapas válidas");
  });
});

/** Cliente falso de OpenRouter (formato OpenAI chat completions). */
function fakeOpenRouter(script: ChatResponse["choices"][]) {
  const requests: { model: string; messages: { role: string; content?: unknown; tool_call_id?: string }[] }[] = [];
  const client: ChatClient = {
    complete: async (body) => {
      requests.push(structuredClone(body) as (typeof requests)[number]);
      const choices = script.shift();
      if (!choices) throw new Error("Sin respuestas guionadas");
      return { choices };
    },
  };
  return { client: { openrouter: client }, requests };
}

const call = (id: string, name: string, args: object) => ({
  id,
  type: "function" as const,
  function: { name, arguments: JSON.stringify(args) },
});

describe("asistente IA (OpenRouter)", () => {
  beforeEach(() => useProvider("openrouter", "proveedor/modelo-elegido"));

  it("usa el modelo configurado, ejecuta herramientas y responde", async () => {
    await seedFunnel();
    const lead = await createLead({ name: "Pedro", channel: "SIMULATOR" });
    await inbound(lead.id, "Hola, busco una moto");
    const reasoning = [{ type: "reasoning.text", text: "pensando" }];
    const { client, requests } = fakeOpenRouter([
      [
        {
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [call("c1", "move_stage", { stage: "Calificado", reason: "busca moto" })],
            reasoning_details: reasoning,
          },
        },
      ],
      [{ finish_reason: "stop", message: { role: "assistant", content: "¿Para ciudad o carretera?" } }],
    ]);
    await runAgent(lead.id, client);

    expect(requests[0].model).toBe("proveedor/modelo-elegido");
    expect(requests[0].messages[0].role).toBe("system");
    expect(requests[0].messages[1].content).toContain("Cliente: Hola, busco una moto");
    // El turno de herramientas vuelve con su razonamiento y el resultado como mensaje "tool".
    expect(requests[1].messages.at(-2)).toMatchObject({ role: "assistant", reasoning_details: reasoning });
    expect(requests[1].messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "c1" });

    const updated = await db.lead.findUniqueOrThrow({
      where: { id: lead.id },
      include: { stage: true, messages: true, transcript: true },
    });
    expect(updated.stage.name).toBe("Calificado");
    expect(updated.messages.at(-1)).toMatchObject({ author: "AI", body: "¿Para ciudad o carretera?" });
    expect(updated.transcript?.format).toBe("openai");
  });

  it("un error de OpenRouter responde el mensaje de respaldo y pausa la IA", async () => {
    await seedFunnel();
    const lead = await createLead({ name: "Pedro", channel: "SIMULATOR" });
    await inbound(lead.id, "Hola");
    const { client } = fakeOpenRouter([]);
    await runAgent(lead.id, client);
    const updated = await db.lead.findUniqueOrThrow({ where: { id: lead.id }, include: { messages: true } });
    expect(updated.aiEnabled).toBe(false);
    expect(updated.messages.at(-1)?.body).toBe(FALLBACK_REPLY);
  });

  it("al cambiar de proveedor, parte un historial nuevo con toda la conversación", async () => {
    await seedFunnel();
    const lead = await createLead({ name: "Pedro", channel: "SIMULATOR" });
    await useProvider("anthropic");
    await inbound(lead.id, "Hola");
    await runAgent(lead.id, fakeAnthropic([{ stop_reason: "end_turn", content: [text("¡Hola! ¿Qué buscas?")] }]).client);

    await useProvider("openrouter");
    await inbound(lead.id, "Una moto");
    const { client, requests } = fakeOpenRouter([
      [{ finish_reason: "stop", message: { role: "assistant", content: "¿Para ciudad?" } }],
    ]);
    await runAgent(lead.id, client);

    const sent = requests[0].messages;
    expect(sent).toHaveLength(2);
    expect(sent[1].content).toContain("Cliente: Hola\nBella (tú): ¡Hola! ¿Qué buscas?\nCliente: Una moto");
    const transcript = await db.agentTranscript.findUniqueOrThrow({ where: { leadId: lead.id } });
    expect(transcript.format).toBe("openai");
  });
});
