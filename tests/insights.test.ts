import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createLead } from "@/lib/domain/leads";
import { setSetting } from "@/lib/settings";
import { parseInsights, refreshLeadInsights } from "@/lib/ai/insights";
import type { AiConfig } from "@/lib/ai/config";
import type { AnthropicClient, ChatClient } from "@/lib/ai/providers";
import { scoreLevel } from "@/lib/labels";
import { seedFunnel } from "./factories";

function fakeOpenRouter(replies: string[]) {
  const requests: { model: string; messages: { role: string; content: string }[] }[] = [];
  const client: ChatClient = {
    async complete(body) {
      requests.push(structuredClone(body) as (typeof requests)[number]);
      const content = replies.shift();
      if (content === undefined) throw new Error("Sin respuestas guionadas");
      return { model: "x", choices: [{ finish_reason: "stop", message: { role: "assistant", content } }] };
    },
  };
  return { clients: { openrouter: client }, requests };
}

async function leadWithChat() {
  await seedFunnel();
  const lead = await createLead({ name: "Ana", channel: "SIMULATOR" });
  await db.message.create({ data: { leadId: lead.id, author: "CONTACT", body: "Hola, ¿precio de la parcela en Ovalle?" } });
  await db.message.create({ data: { leadId: lead.id, author: "AI", body: "Desde $25.000.000. ¿Te interesa visitarla?" } });
  return lead;
}

const json = (resumen: string, puntaje: number, motivo = "") => JSON.stringify({ resumen, puntaje, motivo });

describe("resumen y puntaje del lead", () => {
  it("resume la conversación visible con el modelo chico y guarda el puntaje", async () => {
    await setSetting<AiConfig>("ai", { provider: "openrouter", model: "grande", effort: "high", summaryModel: "chico" });
    const lead = await leadWithChat();
    const { clients, requests } = fakeOpenRouter([
      "```json\n" + json("Preguntó precio en Ovalle;\n evalúa visitar.", 62, "Interés concreto, falta presupuesto") + "\n```",
    ]);

    expect(await refreshLeadInsights(lead.id, { clients })).toBe(true);

    expect(requests[0].model).toBe("chico");
    const input = requests[0].messages[1].content;
    expect(input).toContain("Etapa del funnel: Nuevo");
    expect(input).toContain("Cliente: Hola, ¿precio de la parcela en Ovalle?");
    expect(input).toContain("Asistente IA: Desde $25.000.000");
    const saved = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(saved).toMatchObject({
      aiSummary: "Preguntó precio en Ovalle; evalúa visitar.",
      score: 62,
      scoreReason: "Interés concreto, falta presupuesto",
    });
    // El historial de la asistente no se toca.
    expect(await db.agentTranscript.count()).toBe(0);
  });

  it("no vuelve a llamar al modelo si no hay mensajes nuevos, salvo que se fuerce", async () => {
    const lead = await leadWithChat();
    const { clients, requests } = fakeOpenRouter([json("Primera", 30), json("Segunda", 80)]);

    await refreshLeadInsights(lead.id, { clients });
    expect(await refreshLeadInsights(lead.id, { clients })).toBe(false);
    expect(requests).toHaveLength(1);

    expect(await refreshLeadInsights(lead.id, { clients, force: true })).toBe(true);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).aiSummary).toBe("Segunda");
  });

  it("si el modelo no devuelve JSON válido, deja el resumen anterior", async () => {
    const lead = await leadWithChat();
    await db.lead.update({ where: { id: lead.id }, data: { aiSummary: "Anterior", score: 50 } });
    const { clients } = fakeOpenRouter(["No sé"]);

    expect(await refreshLeadInsights(lead.id, { clients })).toBe(false);
    expect(await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({ aiSummary: "Anterior", score: 50 });
  });

  it("funciona con la API de Anthropic", async () => {
    await setSetting<AiConfig>("ai", { provider: "anthropic", model: "grande", effort: "medium" });
    const lead = await leadWithChat();
    const requests: { model: string }[] = [];
    const anthropic = {
      beta: {
        messages: {
          create: async (req: { model: string }) => {
            requests.push(req);
            return { content: [{ type: "text", text: json("Quiere visitar el sábado", 85) }] };
          },
        },
      },
    } as unknown as AnthropicClient;

    expect(await refreshLeadInsights(lead.id, { clients: { anthropic } })).toBe(true);
    expect(requests[0].model).toBe("claude-haiku-5-5");
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).score).toBe(85);
  });

  it("no hace nada sin conversación", async () => {
    await seedFunnel();
    const lead = await createLead({ name: "Sin mensajes", channel: "SIMULATOR" });
    const { clients, requests } = fakeOpenRouter([]);
    expect(await refreshLeadInsights(lead.id, { clients })).toBe(false);
    expect(requests).toHaveLength(0);
  });
});

describe("parseInsights y niveles", () => {
  it("acota el puntaje a 0-100 y rechaza respuestas incompletas", () => {
    expect(parseInsights(json("Ok", 140))?.score).toBe(100);
    expect(parseInsights(json("Ok", -3))?.score).toBe(0);
    expect(parseInsights('{"resumen": "", "puntaje": 50}')).toBeNull();
    expect(parseInsights('{"resumen": "Ok", "puntaje": "alto"}')).toBeNull();
  });

  it("clasifica bajo, medio y alto", () => {
    expect([scoreLevel(39), scoreLevel(40), scoreLevel(69), scoreLevel(70)]).toEqual(["bajo", "medio", "medio", "alto"]);
  });
});
