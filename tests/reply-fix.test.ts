import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createLead } from "@/lib/domain/leads";
import { getAssistantSettings, setSetting, DEFAULT_ASSISTANT, type AssistantSettings } from "@/lib/settings";
import type { AiConfig } from "@/lib/ai/config";
import type { ChatClient, ChatResponse } from "@/lib/ai/providers";
import { applyFix, proposeFix, tryFix } from "@/lib/domain/reply-fix";
import { seedFunnel } from "./factories";

const BIENVENIDA = "BIENVENIDA (cuando el cliente escribe por primera vez): ofrece seguir conmigo o hablar con un ejecutivo.";
const INSTRUCTIONS = `Eres cercana.\n\n${BIENVENIDA}\n\nResponde breve.`;
const CONTEXT = "<crm_state>\nContacto: Diego\nEtapa actual: Nuevo\n</crm_state>\n\nEmpresa (envío masivo «Matanzas»): Hola Diego\nCliente: hola buenas tardes";

function fakeOpenRouter(script: (string | ChatResponse["choices"])[]) {
  const requests: { model: string; messages: { role: string; content?: unknown }[] }[] = [];
  const client: ChatClient = {
    complete: async (body) => {
      requests.push(structuredClone(body) as (typeof requests)[number]);
      const next = script.shift();
      if (next === undefined) throw new Error("Sin respuestas guionadas");
      return {
        model: "x",
        choices: typeof next === "string" ? [{ finish_reason: "stop", message: { role: "assistant", content: next } }] : next,
      };
    },
  };
  return { clients: { openrouter: client }, requests };
}

const textOf = (content: unknown) =>
  typeof content === "string" ? content : (content as { text: string }[]).map((p) => p.text).join("");

async function answered() {
  await setSetting<AiConfig>("ai", { provider: "openrouter", model: "grande", effort: "high", summaryModel: "chico" });
  await setSetting<AssistantSettings>("assistant", { ...DEFAULT_ASSISTANT, instructions: INSTRUCTIONS });
  const stages = await seedFunnel();
  const lead = await createLead({ name: "Diego", channel: "SIMULATOR" });
  const ai = await db.message.create({ data: { leadId: lead.id, author: "AI", body: "¡Hola! ¿Sigues conmigo o con un ejecutivo?" } });
  await db.agentRun.create({
    data: {
      leadId: lead.id,
      messageId: ai.id,
      provider: "openrouter",
      model: "grande",
      effort: "high",
      stageName: "Nuevo",
      system: `Instrucciones de la empresa:\n${INSTRUCTIONS}`,
      context: CONTEXT,
      outcome: "reply",
      startedAt: new Date(),
      durationMs: 1000,
    },
  });
  await db.agentTranscript.create({
    data: {
      leadId: lead.id,
      format: "openai",
      syncedUntil: new Date(),
      messages: [
        { role: "user", content: "turno anterior" },
        { role: "assistant", content: "respuesta anterior" },
        { role: "user", content: CONTEXT },
        { role: "assistant", content: ai.body },
      ],
    },
  });
  return { lead, ai, stages };
}

const proposalJson = (o: object) => JSON.stringify({ etapa: "", buscar: "", ejemplo_bueno: "", explicacion: "Así sigue el tema del envío.", ...o });

describe("corregir una respuesta en el lugar que la causó", () => {
  it("propone editar solo el párrafo de las instrucciones que la causó", async () => {
    const { lead, ai } = await answered();
    const { clients, requests } = fakeOpenRouter([
      proposalJson({
        donde: "instrucciones",
        buscar: "BIENVENIDA (cuando el cliente escribe por primera vez):",
        reemplazar: "BIENVENIDA (cuando el cliente escribe por primera vez y no le escribimos nosotros antes):",
      }),
    ]);

    const fix = await proposeFix({ leadId: lead.id, messageId: ai.id, expected: "Que hable de Vive Matanzas" }, clients);

    expect(fix).toMatchObject({ target: "instructions", label: "Instrucciones de la asistente", current: INSTRUCTIONS });
    expect(fix.proposed).toBe(INSTRUCTIONS.replace("primera vez):", "primera vez y no le escribimos nosotros antes):"));
    const input = textOf(requests[0].messages[1].content);
    expect(input).toContain("<esperaba>\nQue hable de Vive Matanzas");
    expect(input).toContain("- Nuevo: regla de avance: (vacía)");
    expect(requests[0].model).toBe("chico");
  });

  it("si el fragmento a cambiar no existe, no inventa el cambio", async () => {
    const { lead, ai } = await answered();
    const { clients } = fakeOpenRouter([proposalJson({ donde: "instrucciones", buscar: "No existe este texto", reemplazar: "x" })]);
    await expect(proposeFix({ leadId: lead.id, messageId: ai.id, expected: "otra cosa" }, clients)).rejects.toThrow("no está en la configuración");
  });

  it("propone reglas de etapa y marca lo que no es de la configuración", async () => {
    const { lead, ai, stages } = await answered();
    const { clients } = fakeOpenRouter([
      proposalJson({ donde: "regla_avance", etapa: "nuevo", reemplazar: "Cuando diga su presupuesto." }),
      proposalJson({ donde: "plataforma", reemplazar: "" }),
    ]);
    const stage = await proposeFix({ leadId: lead.id, messageId: ai.id, expected: "Que lo mueva" }, clients);
    expect(stage).toMatchObject({ target: "stage_exit", label: "Regla de avance de «Nuevo»", refId: stages[0].id, current: "" });
    const platform = await proposeFix({ leadId: lead.id, messageId: ai.id, expected: "otra" }, clients);
    expect(platform).toMatchObject({ target: "platform", proposed: "" });
  });

  it("prueba el cambio repitiendo el turno, sin enviar nada ni tocar el CRM", async () => {
    const { lead, ai } = await answered();
    const proposed = INSTRUCTIONS.replace("primera vez)", "primera vez y no le escribimos antes)");
    const { clients, requests } = fakeOpenRouter([
      [
        {
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{ id: "c1", type: "function", function: { name: "move_stage", arguments: JSON.stringify({ stage: "Calificado" }) } }],
          },
        },
      ],
      "¡Hola Diego! Vive Matanzas tiene parcelas desde 5.000 m². ¿Buscas para invertir o para vivir?",
    ]);

    const trial = await tryFix(
      { leadId: lead.id, messageId: ai.id, fix: { target: "instructions", proposed, current: INSTRUCTIONS, goodExample: "", refId: null } },
      clients,
    );

    expect(trial).toEqual({
      reply: "¡Hola Diego! Vive Matanzas tiene parcelas desde 5.000 m². ¿Buscas para invertir o para vivir?",
      actions: ["Mover el lead a «Calificado»"],
    });
    expect(requests[0].model).toBe("grande");
    const system = textOf(requests[0].messages[0].content);
    expect(system).toContain("no le escribimos antes");
    // El historial anterior al turno, y el turno tal como lo recibió.
    expect(requests[0].messages.slice(1).map((m) => textOf(m.content))).toEqual(["turno anterior", "respuesta anterior", CONTEXT]);
    // Nada cambió: ni etapa, ni mensajes, ni instrucciones.
    const after = await db.lead.findUniqueOrThrow({ where: { id: lead.id }, include: { stage: true } });
    expect(after.stage.name).toBe("Nuevo");
    expect(await db.message.count({ where: { leadId: lead.id } })).toBe(1);
    expect((await getAssistantSettings()).instructions).toBe(INSTRUCTIONS);
  });

  it("aplica el cambio solo si el texto no cambió desde la propuesta", async () => {
    const { lead, ai, stages } = await answered();
    const { clients } = fakeOpenRouter([
      proposalJson({ donde: "instrucciones", buscar: "Responde breve.", reemplazar: "Responde breve y sigue el tema del último mensaje de la empresa." }),
      proposalJson({ donde: "regla_avance", etapa: "Nuevo", reemplazar: "Cuando diga su presupuesto." }),
      proposalJson({ donde: "aprendizaje", reemplazar: "Si le escribimos primero, sigue ese tema.", ejemplo_bueno: "¡Hola Diego!" }),
    ]);
    const args = { leadId: lead.id, messageId: ai.id, expected: "Que siga el tema" };

    const instructions = await proposeFix(args, clients);
    await applyFix({ leadId: lead.id, messageId: ai.id, fix: instructions, createdBy: "Lukas" });
    expect((await getAssistantSettings()).instructions).toContain("sigue el tema del último mensaje de la empresa");
    // La misma propuesta otra vez: las instrucciones ya no son las que vio.
    await expect(applyFix({ leadId: lead.id, messageId: ai.id, fix: instructions, createdBy: "Lukas" })).rejects.toThrow("cambió");

    await applyFix({ leadId: lead.id, messageId: ai.id, fix: await proposeFix(args, clients), createdBy: "Lukas" });
    expect((await db.stage.findUniqueOrThrow({ where: { id: stages[0].id } })).exitCriteria).toBe("Cuando diga su presupuesto.");

    await applyFix({ leadId: lead.id, messageId: ai.id, fix: await proposeFix(args, clients), createdBy: "Lukas" });
    expect(await db.aiLesson.findFirstOrThrow()).toMatchObject({
      rule: "Si le escribimos primero, sigue ese tema.",
      goodExample: "¡Hola Diego!",
      status: "ACTIVE",
      createdBy: "Lukas",
    });
  });
});
