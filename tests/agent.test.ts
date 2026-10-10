import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createLead } from "@/lib/domain/leads";
import { setSetting } from "@/lib/settings";
import { FALLBACK_REPLY, runAgent } from "@/lib/ai/agent";
import type { AiConfig } from "@/lib/ai/config";
import type { AnthropicClient, ChatClient, ChatResponse } from "@/lib/ai/providers";
import { KNOWLEDGE_INLINE_MAX_CHARS } from "@/lib/knowledge";
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

  it("recibe las reglas de avance de las etapas que atiende la IA", async () => {
    const [nuevo, calificado, , humana] = await seedFunnel();
    await db.stage.update({ where: { id: nuevo.id }, data: { exitCriteria: "Cuando diga qué producto busca." } });
    await db.stage.update({
      where: { id: calificado.id },
      data: { exitCriteria: '  Si pide cotización formal, mover a "Atención humana".  ' },
    });
    // Las etapas de atención humana no llevan regla para la IA aunque tengan texto guardado.
    await db.stage.update({ where: { id: humana.id }, data: { exitCriteria: "No debería aparecer" } });
    const lead = await createLead({ name: "Pedro", channel: "SIMULATOR" });
    await inbound(lead.id, "Hola");

    const { client, requests } = fakeAnthropic([{ stop_reason: "end_turn", content: [text("¡Hola!")] }]);
    await runAgent(lead.id, client);

    const state = (requests[0].messages[0].content as { text: string }[])[0].text;
    expect(state).toContain('- Desde "Nuevo" (siguiente: "Calificado"): Cuando diga qué producto busca.');
    expect(state).toContain('- Desde "Calificado" (siguiente: "Cotización"): Si pide cotización formal, mover a "Atención humana".');
    expect(state).not.toContain("Cotización\" (siguiente");
    expect(state).not.toContain("No debería aparecer");
  });

  it("sin reglas de avance no agrega la sección al estado del CRM", async () => {
    await seedFunnel();
    const lead = await createLead({ name: "Pedro", channel: "SIMULATOR" });
    await inbound(lead.id, "Hola");
    const { client, requests } = fakeAnthropic([{ stop_reason: "end_turn", content: [text("¡Hola!")] }]);
    await runAgent(lead.id, client);
    expect((requests[0].messages[0].content as { text: string }[])[0].text).not.toContain("Reglas de avance");
  });

  it("ve los campos del cliente en el estado del CRM y los completa", async () => {
    await seedFunnel();
    await db.customField.create({
      data: { name: "Presupuesto", type: "NUMBER", position: 0, description: "Monto total en pesos" },
    });
    const lead = await createLead({ name: "Pedro", channel: "SIMULATOR" });
    await inbound(lead.id, "Tengo unos 35 millones");

    const { client, requests } = fakeAnthropic([
      {
        stop_reason: "tool_use",
        content: [toolUse("t1", "set_contact_field", { field: "Presupuesto", value: "35 millones" })],
      },
      { stop_reason: "end_turn", content: [text("¡Perfecto!")] },
    ]);
    await runAgent(lead.id, client);

    const firstTurn = requests[0].messages[0].content as { text: string }[];
    expect(firstTurn[0].text).toContain("- Presupuesto = sin dato (número; Monto total en pesos)");
    expect((await db.contactFieldValue.findFirstOrThrow()).value).toBe("35000000");
    const run = await db.agentRun.findFirstOrThrow();
    expect(run.steps).toContainEqual(expect.objectContaining({ type: "tool", name: "set_contact_field" }));
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

/** Texto de un mensaje enviado a OpenRouter (el último va como bloque con marca de caché). */
const textOf = (content: unknown) =>
  typeof content === "string" ? content : (content as { text: string }[]).map((p) => p.text).join("");

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
    expect(textOf(requests[0].messages[1].content)).toContain("Cliente: Hola, busco una moto");
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
    expect(textOf(sent[1].content)).toContain("Cliente: Hola\nBella (tú): ¡Hola! ¿Qué buscas?\nCliente: Una moto");
    const transcript = await db.agentTranscript.findUniqueOrThrow({ where: { leadId: lead.id } });
    expect(transcript.format).toBe("openai");
  });
});

describe("caché y base de conocimiento", () => {
  it("incluye la base de conocimiento completa en las instrucciones cuando es pequeña", async () => {
    await useProvider("anthropic");
    await seedFunnel();
    await db.knowledgeDoc.create({ data: { title: "Horario", content: "Atendemos de 9 a 18 horas." } });
    const lead = await createLead({ name: "Ana", channel: "SIMULATOR" });
    await inbound(lead.id, "¿A qué hora atienden?");
    const { client, requests } = fakeAnthropic([{ stop_reason: "end_turn", content: [text("De 9 a 18.")] }]);
    await runAgent(lead.id, client);

    const system = (requests[0] as unknown as { system: string }).system;
    expect(system).toContain('<documento titulo="Horario">\nAtendemos de 9 a 18 horas.');
    expect(system).not.toContain("Consulta search_knowledge");
  });

  it("deja la base de conocimiento para search_knowledge cuando es grande", async () => {
    await useProvider("anthropic");
    await seedFunnel();
    await db.knowledgeDoc.create({ data: { title: "Manual", content: "x".repeat(KNOWLEDGE_INLINE_MAX_CHARS + 1) } });
    const lead = await createLead({ name: "Ana", channel: "SIMULATOR" });
    await inbound(lead.id, "Hola");
    const { client, requests } = fakeAnthropic([{ stop_reason: "end_turn", content: [text("¡Hola!")] }]);
    await runAgent(lead.id, client);

    const system = (requests[0] as unknown as { system: string }).system;
    expect(system).not.toContain("<base_de_conocimiento>");
    expect(system).toContain("Consulta search_knowledge");
  });

  it("en OpenRouter marca las instrucciones y el último mensaje para la caché, sin tocar el historial", async () => {
    await useProvider("openrouter", "anthropic/claude");
    await seedFunnel();
    const lead = await createLead({ name: "Pedro", channel: "SIMULATOR" });
    await inbound(lead.id, "Hola");
    const { client, requests } = fakeOpenRouter([
      [{ finish_reason: "stop", message: { role: "assistant", content: "¡Hola!" } }],
    ]);
    await runAgent(lead.id, client);

    const [system, user] = requests[0].messages;
    expect(system).toMatchObject({ role: "system", content: [{ type: "text", cache_control: { type: "ephemeral" } }] });
    expect(user).toMatchObject({ role: "user", content: [{ type: "text", cache_control: { type: "ephemeral" } }] });
    const transcript = await db.agentTranscript.findUniqueOrThrow({ where: { leadId: lead.id } });
    const saved = transcript.messages as { role: string; content: unknown }[];
    expect(typeof saved[0].content).toBe("string");
  });
});
