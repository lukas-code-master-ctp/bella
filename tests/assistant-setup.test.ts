import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { AiConfig } from "@/lib/ai/config";
import type { ChatClient } from "@/lib/ai/providers";
import { applyAssistantSetup, draftAssistantSetup, type SetupAnswers } from "@/lib/domain/assistant-setup";
import { getAssistantSettings, setSetting } from "@/lib/settings";
import { seedFunnel } from "./factories";

function fakeOpenRouter(replies: string[]) {
  const requests: { messages: { role: string; content: string }[] }[] = [];
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

const answers: SetupAnswers = {
  companyName: "Casas Sur",
  assistantName: "Sofía",
  offer: "Casas prefabricadas en el sur de Chile para familias",
  tone: "cercana, con tuteo",
  qualify: "comuna, terreno propio, presupuesto",
  handoff: "cuando pide cotización formal",
  avoid: "no dar plazos de entrega",
  facts: "Modelo Austral 60 m2 desde $25.000.000. Pago contado o crédito.",
};

const reply = JSON.stringify({
  instrucciones: "Eres Sofía, la asistente de Casas Sur. Pregunta de a una: comuna, terreno y presupuesto.",
  conocimiento: [{ titulo: "Modelos y precios", contenido: "Austral 60 m2 desde $25.000.000." }, { titulo: "", contenido: "x" }],
  etapas: [{ nombre: "Nuevo", regla: "Con comuna y terreno, mover a Calificado." }, { nombre: "Inventada", regla: "x" }],
});

describe("Presenta a tu asistente", () => {
  it("la IA redacta instrucciones, conocimiento y reglas solo para las etapas que atiende", async () => {
    await setSetting<AiConfig>("ai", { provider: "openrouter", model: "grande", effort: "high", summaryModel: "chico" });
    const stages = await seedFunnel();
    const { clients, requests } = fakeOpenRouter(["```json\n" + reply + "\n```"]);

    const draft = await draftAssistantSetup(answers, clients);

    const input = requests[0].messages[1].content;
    expect(input).toContain("Casas prefabricadas");
    expect(input).toContain('"Atención humana" (atención humana)');
    expect(input).toContain("Modelo Austral");
    expect(draft.instructions).toContain("Eres Sofía");
    expect(draft.docs).toEqual([{ title: "Modelos y precios", content: "Austral 60 m2 desde $25.000.000." }]);
    expect(draft.stages.map((s) => s.name)).toEqual(["Nuevo", "Calificado", "Cotización"]);
    expect(draft.stages[0].exitCriteria).toBe("Con comuna y terreno, mover a Calificado.");
    expect(draft.stages[1].exitCriteria).toBe("");
    // Nada se guarda al redactar.
    expect((await getAssistantSettings()).companyName).toBe("nuestra empresa");
    expect(await db.knowledgeDoc.count()).toBe(0);

    await applyAssistantSetup({ ...draft, instructions: draft.instructions + " Editado." });
    const saved = await getAssistantSettings();
    expect(saved).toMatchObject({ assistantName: "Sofía", companyName: "Casas Sur" });
    expect(saved.instructions).toMatch(/Editado\.$/);
    expect(await db.knowledgeDoc.findMany({ select: { title: true } })).toEqual([{ title: "Modelos y precios" }]);
    const nuevo = await db.stage.findUniqueOrThrow({ where: { id: stages[0].id } });
    expect(nuevo.exitCriteria).toBe("Con comuna y terreno, mover a Calificado.");
  });

  it("pide la empresa y qué vende antes de llamar a la IA", async () => {
    const { clients, requests } = fakeOpenRouter([]);
    await expect(draftAssistantSetup({ ...answers, offer: " " }, clients)).rejects.toThrow("qué vende");
    await expect(draftAssistantSetup({ ...answers, companyName: "" }, clients)).rejects.toThrow("nombre de la empresa");
    expect(requests).toHaveLength(0);
  });

  it("no guarda reglas en las etapas de atención humana", async () => {
    const stages = await seedFunnel();
    const human = stages[3];
    await applyAssistantSetup({
      assistantName: "Sofía",
      companyName: "Casas Sur",
      instructions: "Eres Sofía.",
      docs: [],
      stages: [{ id: human.id, name: human.name, exitCriteria: "nunca" }],
    });
    expect((await db.stage.findUniqueOrThrow({ where: { id: human.id } })).exitCriteria).toBeNull();
  });
});
