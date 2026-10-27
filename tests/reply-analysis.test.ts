import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createLead } from "@/lib/domain/leads";
import { DEFAULT_ASSISTANT, setSetting } from "@/lib/settings";
import { buildSystemPrompt } from "@/lib/ai/agent";
import type { AiConfig } from "@/lib/ai/config";
import type { ChatClient } from "@/lib/ai/providers";
import { citationSource, explainReply, locate } from "@/lib/domain/reply-analysis";
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

const INSTRUCTIONS =
  "BIENVENIDA (cuando el cliente escribe por primera vez)\nPreséntate y ofrécele dos opciones: seguir conmigo o hablar con un ejecutivo.";

const SYSTEM = buildSystemPrompt(
  { ...DEFAULT_ASSISTANT, assistantName: "Valentina", instructions: `${INSTRUCTIONS}\n\nEn esta línea de negocio:\nHabla de parcelas.` },
  [{ title: "Preguntas frecuentes", content: "Las visitas son los sábados." }],
  [],
  null,
  [{ rule: "No repitas el precio.", badExample: "", goodExample: "" }],
);

const CONTEXT = [
  "<crm_state>",
  "Contacto: Diego",
  "Etapa actual: Inicial",
  "Reglas de avance entre etapas (definidas por la empresa; síguelas al usar move_stage o handoff_to_human, y si la regla no nombra otra etapa, mueve a la siguiente):",
  '- Desde "Inicial" (siguiente: "Calificado"): cuando diga su presupuesto.',
  "Etiquetas actuales: ninguna",
  "</crm_state>",
  "",
  "Ejecutivo (Administrador): Hola Diego, vimos que te interesó Vive Matanzas.",
  "Cliente: hola buenas tardes",
].join("\n");

describe("analizar una respuesta de la IA", () => {
  it("encuentra la cita aunque cambien los espacios o venga entre comillas", () => {
    expect(locate(SYSTEM, "“Preséntate y ofrécele   dos opciones: seguir conmigo o hablar con un ejecutivo.”")).toBe(
      SYSTEM.indexOf("Preséntate"),
    );
    expect(locate(SYSTEM, "algo que no está")).toBe(-1);
  });

  it("dice de dónde sale cada cita", () => {
    const src = (q: string) => citationSource(q, SYSTEM, CONTEXT);
    expect(src("cuando el cliente escribe por primera vez")).toMatchObject({ kind: "instructions", href: "/settings/assistant" });
    expect(src("Habla de parcelas.")).toMatchObject({ kind: "funnel" });
    expect(src("No repitas el precio.")).toMatchObject({ kind: "lesson", href: "/settings/lessons" });
    expect(src("Las visitas son los sábados.")).toMatchObject({ kind: "knowledge", label: "Base de conocimiento: Preguntas frecuentes" });
    expect(src("Tu respuesta final de cada turno es exactamente el mensaje que recibirá el cliente")).toMatchObject({
      kind: "platform",
      href: null,
    });
    expect(src("cuando diga su presupuesto.")).toMatchObject({ kind: "stage_rule", href: "/settings/funnel" });
    expect(src("Etiquetas actuales: ninguna")).toMatchObject({ kind: "crm" });
    expect(src("Ejecutivo (Administrador): Hola Diego")).toMatchObject({ kind: "conversation" });
    expect(src("inventado")).toMatchObject({ kind: "unknown" });
  });

  it("explica la respuesta con lo que se guardó del turno, sin guardar nada", async () => {
    await setSetting<AiConfig>("ai", { provider: "openrouter", model: "grande", effort: "high", summaryModel: "chico" });
    await seedFunnel();
    const lead = await createLead({ name: "Diego", channel: "SIMULATOR" });
    const ai = await db.message.create({ data: { leadId: lead.id, author: "AI", body: "¡Hola Diego! ¿Sigues conmigo o con un ejecutivo?" } });
    await db.agentRun.create({
      data: {
        leadId: lead.id,
        messageId: ai.id,
        provider: "openrouter",
        model: "grande",
        effort: "high",
        stageName: "Inicial",
        system: SYSTEM,
        context: CONTEXT,
        steps: [{ type: "model", reasoning: "Es su primer mensaje: toca la bienvenida." }],
        outcome: "reply",
        startedAt: new Date(),
        durationMs: 1000,
      },
    });
    const { clients, requests } = fakeOpenRouter([
      JSON.stringify({
        resumen: "La asistente creyó que era el primer mensaje del cliente.",
        citas: [
          { texto: "cuando el cliente escribe por primera vez", por_que: "Por eso ofreció las dos opciones." },
          { texto: "", por_que: "vacía" },
        ],
        falto: ["No sabía que el primer mensaje fue una campaña."],
      }),
    ]);

    const analysis = await explainReply({ leadId: lead.id, messageId: ai.id }, clients);

    expect(analysis).toEqual({
      summary: "La asistente creyó que era el primer mensaje del cliente.",
      citations: [
        {
          quote: "cuando el cliente escribe por primera vez",
          why: "Por eso ofreció las dos opciones.",
          source: { kind: "instructions", label: "Instrucciones de la asistente", href: "/settings/assistant" },
        },
      ],
      missing: ["No sabía que el primer mensaje fue una campaña."],
      currentConfig: false,
    });
    const input = requests[0].messages[1].content;
    expect(input).toContain(INSTRUCTIONS);
    expect(input).toContain("Cliente: hola buenas tardes");
    expect(input).toContain("Es su primer mensaje: toca la bienvenida.");
    expect(input).toContain("<respuesta>\n¡Hola Diego! ¿Sigues conmigo o con un ejecutivo?");
  });

  it("no analiza mensajes sin registro ni mensajes que no son de la IA", async () => {
    await seedFunnel();
    const lead = await createLead({ name: "Diego", channel: "SIMULATOR" });
    const ai = await db.message.create({ data: { leadId: lead.id, author: "AI", body: "Hola" } });
    const contact = await db.message.create({ data: { leadId: lead.id, author: "CONTACT", body: "Hola" } });
    await expect(explainReply({ leadId: lead.id, messageId: ai.id })).rejects.toThrow("no tiene registro");
    await expect(explainReply({ leadId: lead.id, messageId: contact.id })).rejects.toThrow("Solo se pueden analizar");
  });
});
