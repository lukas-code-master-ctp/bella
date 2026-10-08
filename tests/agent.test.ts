import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createLead } from "@/lib/domain/leads";
import { FALLBACK_REPLY, runAgent, type AgentClient } from "@/lib/ai/agent";
import { executive, seedFunnel } from "./factories";

type Scripted = { stop_reason: string; content: object[] };

/** Cliente falso que devuelve respuestas guionadas y registra las solicitudes. */
function fakeClient(script: Scripted[]) {
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
  } as unknown as AgentClient;
  return { client, requests };
}

const toolUse = (id: string, name: string, input: object) => ({ type: "tool_use", id, name, input });
const text = (t: string) => ({ type: "text", text: t });

async function inbound(leadId: string, body: string) {
  await db.message.create({ data: { leadId, author: "CONTACT", body } });
}

describe("asistente IA", () => {
  it("busca inventario, etiqueta, mueve de etapa y responde al cliente", async () => {
    await seedFunnel();
    await db.tag.create({ data: { category: "Producto", name: "Motos" } });
    await db.inventoryItem.create({
      data: { rowNumber: 2, data: { Modelo: "Honda CB190", Precio: "2.490.000" }, searchText: "honda cb190 2490000 moto" },
    });
    const lead = await createLead({ name: "Pedro", channel: "SIMULATOR" });
    await inbound(lead.id, "Hola, ¿tienen la Honda CB190?");

    const { client, requests } = fakeClient([
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
    const first = fakeClient([{ stop_reason: "end_turn", content: [text("¡Hola! ¿En qué te ayudo?")] }]);
    await runAgent(lead.id, first.client);

    await inbound(lead.id, "Busco una moto");
    const second = fakeClient([{ stop_reason: "end_turn", content: [text("¿Para ciudad o carretera?")] }]);
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
    const { client } = fakeClient([
      { stop_reason: "tool_use", content: [toolUse("t1", "handoff_to_human", { reason: "lo pidió" })] },
      { stop_reason: "end_turn", content: [text("Te contacto con un ejecutivo.")] },
    ]);
    await runAgent(lead.id, client);

    const updated = await db.lead.findUniqueOrThrow({ where: { id: lead.id }, include: { stage: true } });
    expect(updated).toMatchObject({ aiEnabled: false, assigneeId: ana.id });
    expect(updated.stage.name).toBe("Atención humana");

    // Con la IA pausada, un nuevo mensaje no dispara otra respuesta.
    await inbound(lead.id, "¿Hola?");
    const idle = fakeClient([]);
    await runAgent(lead.id, idle.client);
    expect(idle.requests).toHaveLength(0);
  });

  it("si el modelo rechaza, responde el mensaje de respaldo y pausa la IA", async () => {
    await seedFunnel();
    const lead = await createLead({ name: "Pedro", channel: "SIMULATOR" });
    await inbound(lead.id, "Hola");
    const { client } = fakeClient([{ stop_reason: "refusal", content: [] }]);
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
    const { client, requests } = fakeClient([
      { stop_reason: "tool_use", content: [toolUse("t1", "move_stage", { stage: "Inexistente", reason: "x" })] },
      { stop_reason: "end_turn", content: [text("¡Hola!")] },
    ]);
    await runAgent(lead.id, client);
    const result = (requests[1].messages.at(-1)!.content as { is_error?: boolean; content: string }[])[0];
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Etapas válidas");
  });
});
