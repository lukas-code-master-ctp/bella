import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createLead } from "@/lib/domain/leads";
import { DEFAULT_ASSISTANT, setSetting } from "@/lib/settings";
import { buildSystemPrompt, runAgent } from "@/lib/ai/agent";
import type { AiConfig } from "@/lib/ai/config";
import type { ChatClient } from "@/lib/ai/providers";
import { applyPreset } from "@/lib/domain/presets";
import { getAssistantSettings } from "@/lib/settings";
import { diffHunks, lineDiff } from "@/lib/line-diff";
import {
  activeLessons,
  applyIntegration,
  createLesson,
  draftIntegration,
  draftLesson,
  listLessons,
  setLessonStatus,
  testLesson,
  updateLesson,
} from "@/lib/domain/ai-lessons";
import { seedFunnel } from "./factories";

function fakeOpenRouter(replies: string[]) {
  const requests: { messages: { role: string; content: string }[]; max_tokens?: number; reasoning?: unknown }[] = [];
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

const REPEATED = "Vive Ovalle está en Ovalle. Antes $19.990.000, ahora $8.990.000.";

async function chat() {
  await setSetting<AiConfig>("ai", { provider: "openrouter", model: "grande", effort: "high", summaryModel: "chico" });
  await seedFunnel();
  const lead = await createLead({ name: "Ana", channel: "SIMULATOR" });
  const at = (s: number) => new Date(Date.UTC(2026, 9, 16, 12, 0, s));
  await db.message.create({ data: { leadId: lead.id, author: "AI", body: "Tenemos Vive Ovalle a $8.990.000.", createdAt: at(1) } });
  await db.message.create({ data: { leadId: lead.id, author: "CONTACT", body: "Me interesa Vive Ovalle", createdAt: at(2) } });
  const ai = await db.message.create({ data: { leadId: lead.id, author: "AI", body: REPEATED, createdAt: at(3) } });
  await db.message.create({ data: { leadId: lead.id, author: "CONTACT", body: "ok", createdAt: at(4) } });
  return { lead, ai };
}

const draftJson = JSON.stringify({
  regla: "No repitas datos que ya diste en la conversación.",
  ejemplo_bueno: "¡Buena elección! ¿Lo pagarías al contado o con financiamiento?",
  choque: "Las instrucciones piden mencionar siempre la promoción.",
});

describe("aprendizajes de la asistente", () => {
  it("la IA redacta la regla con la conversación previa y la corrección", async () => {
    const { ai } = await chat();
    const { clients, requests } = fakeOpenRouter(["```json\n" + draftJson + "\n```"]);

    const draft = await draftLesson({ messageId: ai.id, feedback: "Repitió ubicación y precio" }, clients);

    expect(draft).toMatchObject({
      rule: "No repitas datos que ya diste en la conversación.",
      goodExample: "¡Buena elección! ¿Lo pagarías al contado o con financiamiento?",
      badExample: REPEATED,
      conflict: "Las instrucciones piden mencionar siempre la promoción.",
    });
    const input = requests[0].messages[1].content;
    expect(input).toContain("Cliente: Me interesa Vive Ovalle");
    expect(input).toContain(DEFAULT_ASSISTANT.instructions);
    expect(input).toContain("<correccion>\nRepitió ubicación y precio");
    // Solo lo anterior a la respuesta corregida.
    expect(input).not.toContain("Cliente: ok");
    // Redactar no guarda nada.
    expect(await db.aiLesson.count()).toBe(0);
  });

  it("si la IA no responde en JSON, la regla parte siendo la corrección", async () => {
    const { ai } = await chat();
    const { clients } = fakeOpenRouter(["no sé"]);
    const draft = await draftLesson({ messageId: ai.id, feedback: "Sé más breve" }, clients);
    expect(draft.rule).toBe("Sé más breve");
  });

  it("solo se corrigen mensajes de la IA", async () => {
    const { lead } = await chat();
    const contact = await db.message.findFirstOrThrow({ where: { leadId: lead.id, author: "CONTACT" } });
    await expect(draftLesson({ messageId: contact.id, feedback: "x" })).rejects.toThrow("Solo se pueden corregir");
    await expect(
      createLesson({ messageId: contact.id, rule: "x", goodExample: "", badExample: "", feedback: "", conflict: "", createdBy: "Lukas" }),
    ).rejects.toThrow("Solo se pueden corregir");
  });

  it("queda pendiente y la IA no la usa hasta que un admin la aprueba", async () => {
    const { ai } = await chat();
    const lesson = await createLesson({
      messageId: ai.id,
      rule: "No repitas datos que ya diste.",
      goodExample: "¿Lo pagarías al contado?",
      badExample: REPEATED,
      feedback: "Repitió",
      conflict: "",
      createdBy: "Lukas",
    });
    expect(lesson.status).toBe("PENDING");
    expect(lesson.conversation).toContain("Cliente: Me interesa Vive Ovalle");
    expect(await activeLessons()).toEqual([]);
    expect(buildSystemPrompt(DEFAULT_ASSISTANT, null, [], null, await activeLessons())).not.toContain("Aprendizajes");

    await setLessonStatus(lesson.id, "ACTIVE");
    const prompt = buildSystemPrompt(DEFAULT_ASSISTANT, null, [], null, await activeLessons());
    expect(prompt).toContain("Aprendizajes aprobados por la empresa");
    expect(prompt).toContain("- No repitas datos que ya diste.");
    expect(prompt).toContain('Evita responder así: "Vive Ovalle está en Ovalle. Antes $19.990.000, ahora $8.990.000."');
    expect(prompt).toContain('Mejor así: "¿Lo pagarías al contado?"');
    expect((await db.aiLesson.findUniqueOrThrow({ where: { id: lesson.id } })).approvedAt).not.toBeNull();

    await setLessonStatus(lesson.id, "PAUSED");
    expect(await activeLessons()).toEqual([]);
  });

  it("la asistente recibe los aprendizajes activos en sus instrucciones", async () => {
    const { lead, ai } = await chat();
    const lesson = await createLesson({
      messageId: ai.id,
      rule: "No repitas datos que ya diste.",
      goodExample: "",
      badExample: "",
      feedback: "",
      conflict: "",
      createdBy: "Lukas",
    });
    await setLessonStatus(lesson.id, "ACTIVE");
    const { clients, requests } = fakeOpenRouter(["¿Contado o financiamiento?"]);

    expect(await runAgent(lead.id, clients)).toBe("sent");
    expect(JSON.stringify(requests[0].messages[0].content)).toContain("- No repitas datos que ya diste.");
  });

  it("probar vuelve a escribir la respuesta con la regla, sin enviar nada", async () => {
    const { lead, ai } = await chat();
    const lesson = await createLesson({
      messageId: ai.id,
      rule: "No repitas datos que ya diste.",
      goodExample: "",
      badExample: REPEATED,
      feedback: "",
      conflict: "",
      createdBy: "Lukas",
    });
    const { clients, requests } = fakeOpenRouter(["¡Buena elección! ¿Contado o financiamiento?"]);
    const messagesBefore = await db.message.count({ where: { leadId: lead.id } });

    const tested = await testLesson(lesson.id, clients);

    expect(tested.testReply).toBe("¡Buena elección! ¿Contado o financiamiento?");
    expect(requests[0].messages[0].content).toContain("- No repitas datos que ya diste.");
    expect(requests[0].messages[1].content).toContain("Cliente: Me interesa Vive Ovalle");
    expect(await db.message.count({ where: { leadId: lead.id } })).toBe(messagesBefore);
    expect(await db.agentTranscript.count()).toBe(0);

    // Editar la regla borra la prueba, que ya no corresponde.
    const edited = await updateLesson(lesson.id, { rule: "Otra regla", goodExample: "", badExample: REPEATED });
    expect(edited.testReply).toBeNull();
  });

  it("lista primero las pendientes", async () => {
    const { ai } = await chat();
    const base = { messageId: ai.id, goodExample: "", badExample: "", feedback: "", conflict: "", createdBy: "Lukas" };
    const a = await createLesson({ ...base, rule: "A" });
    await setLessonStatus(a.id, "ACTIVE");
    await createLesson({ ...base, rule: "B" });
    expect((await listLessons()).map((l) => l.rule)).toEqual(["B", "A"]);
  });

  it("integra los activos en las instrucciones y dejan de enviarse aparte", async () => {
    const { ai } = await chat();
    await setSetting("assistant", { ...DEFAULT_ASSISTANT, instructions: "Saluda.\nMenciona siempre la promoción." });
    const base = { messageId: ai.id, goodExample: "", badExample: "", feedback: "", conflict: "", createdBy: "Lukas" };
    const a = await createLesson({ ...base, rule: "No repitas datos que ya diste." });
    await setLessonStatus(a.id, "ACTIVE");
    const pending = await createLesson({ ...base, rule: "Pendiente" });
    const { clients, requests } = fakeOpenRouter([
      "<instrucciones>\nSaluda.\nMenciona la promoción una sola vez; no repitas datos que ya diste.\n</instrucciones>\n" +
        "<cambios>\n- Junté la regla con la de la promoción.\n</cambios>",
    ]);

    const draft = await draftIntegration(clients);

    expect(requests[0].messages[1].content).toContain("- No repitas datos que ya diste.");
    expect(requests[0].messages[1].content).not.toContain("Pendiente");
    expect(draft).toMatchObject({
      current: "Saluda.\nMenciona siempre la promoción.",
      instructions: "Saluda.\nMenciona la promoción una sola vez; no repitas datos que ya diste.",
      changes: ["Junté la regla con la de la promoción."],
      lessonIds: [a.id],
    });
    // Proponer no guarda nada.
    expect((await getAssistantSettings()).instructions).toBe("Saluda.\nMenciona siempre la promoción.");

    await applyIntegration(draft);
    expect((await getAssistantSettings()).instructions).toBe(draft.instructions);
    expect(await db.aiLesson.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ status: "INTEGRATED" });
    expect((await db.aiLesson.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("PENDING");
    expect(await activeLessons()).toEqual([]);

    // Si un preset vuelve a escribir las instrucciones, los integrados se reactivan para no perderlos.
    await applyPreset(db, { id: "prueba", version: 1, assistant: DEFAULT_ASSISTANT, knowledge: [] });
    expect((await activeLessons()).map((l) => l.rule)).toEqual(["No repitas datos que ya diste."]);
  });

  it("no integra si las instrucciones cambiaron desde la propuesta", async () => {
    const { ai } = await chat();
    const a = await createLesson({ messageId: ai.id, rule: "R", goodExample: "", badExample: "", feedback: "", conflict: "", createdBy: "L" });
    await setLessonStatus(a.id, "ACTIVE");
    const { clients } = fakeOpenRouter([`<instrucciones>${DEFAULT_ASSISTANT.instructions} R</instrucciones><cambios></cambios>`]);
    const draft = await draftIntegration(clients);
    await setSetting("assistant", { ...DEFAULT_ASSISTANT, instructions: "Otra cosa" });
    await expect(applyIntegration(draft)).rejects.toThrow("cambiaron");
    expect((await db.aiLesson.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("ACTIVE");
  });

  it("acepta la propuesta aunque falte el cierre de <instrucciones> y deja margen para razonar", async () => {
    const { ai } = await chat();
    const a = await createLesson({ messageId: ai.id, rule: "R", goodExample: "", badExample: "", feedback: "", conflict: "", createdBy: "L" });
    await setLessonStatus(a.id, "ACTIVE");
    const { clients, requests } = fakeOpenRouter([`<instrucciones>${DEFAULT_ASSISTANT.instructions} R\n<cambios>\n- Agregué R.\n</cambios>`]);
    const draft = await draftIntegration(clients);
    expect(draft.instructions).toBe(`${DEFAULT_ASSISTANT.instructions} R`);
    expect(draft.changes).toEqual(["Agregué R."]);
    expect(requests[0]).toMatchObject({ reasoning: { effort: "low" } });
    expect(requests[0].max_tokens).toBeGreaterThanOrEqual(12_000);
  });

  it("rechaza una propuesta incompleta", async () => {
    const { ai } = await chat();
    const a = await createLesson({ messageId: ai.id, rule: "R", goodExample: "", badExample: "", feedback: "", conflict: "", createdBy: "L" });
    await setLessonStatus(a.id, "ACTIVE");
    const { clients } = fakeOpenRouter(["<instrucciones>Hola</instrucciones>"]);
    await expect(draftIntegration(clients)).rejects.toThrow("completas");
  });
});

describe("diferencia de líneas", () => {
  it("marca lo agregado y lo quitado, y resume lo igual", () => {
    const before = ["a", "b", "c", "d", "e", "f", "g"].join("\n");
    const after = ["a", "b", "c", "X", "e", "f", "g"].join("\n");
    const lines = lineDiff(before, after);
    expect(lines.filter((l) => l.kind !== "same")).toEqual([
      { kind: "removed", text: "d" },
      { kind: "added", text: "X" },
    ]);
    const hunks = diffHunks(lines, 1);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].skippedBefore).toBe(2);
    expect(hunks[0].lines.map((l) => l.text)).toEqual(["c", "d", "X", "e"]);
  });
});
