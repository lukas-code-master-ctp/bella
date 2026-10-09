import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createLead, setAiEnabled } from "@/lib/domain/leads";
import { setSetting } from "@/lib/settings";
import { runAgent } from "@/lib/ai/agent";
import { runDueFollowUps, sendFollowUpNow } from "@/lib/ai/follow-ups";
import type { AiConfig } from "@/lib/ai/config";
import type { AnthropicClient } from "@/lib/ai/providers";
import {
  DEFAULT_FOLLOW_UPS,
  formatDelay,
  parseChileDateTime,
  parseDelays,
  withinSendingHours,
  type FollowUpSettings,
} from "@/lib/domain/follow-ups";
import { seedFunnel } from "./factories";

type Scripted = { stop_reason: string; content: object[] };

function fakeAnthropic(script: Scripted[]) {
  const requests: { messages: { role: string; content: { type: string; text?: string }[] }[] }[] = [];
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
  return { clients: { anthropic: client }, requests };
}

const say = (t: string): Scripted => ({ stop_reason: "end_turn", content: [{ type: "text", text: t }] });
const toolUse = (id: string, name: string, input: object): Scripted => ({
  stop_reason: "tool_use",
  content: [{ type: "tool_use", id, name, input }],
});
/** Texto del último turno del usuario que recibió la IA. */
const lastTurn = (r: ReturnType<typeof fakeAnthropic>["requests"]) =>
  r.at(-1)!.messages.at(-1)!.content.map((b) => b.text ?? "").join("\n");

const HOUR = 3600_000;

async function useFollowUps(overrides: Partial<FollowUpSettings> = {}) {
  // Horario completo para que las pruebas no dependan de la hora en que corren.
  await setSetting<FollowUpSettings>("followUps", { ...DEFAULT_FOLLOW_UPS, enabled: true, sendFrom: 0, sendTo: 24, ...overrides });
}

/** Lead con una pregunta del cliente ya respondida por la IA. */
async function conversation() {
  await seedFunnel();
  const lead = await createLead({ name: "Ana", channel: "SIMULATOR" });
  await db.message.create({ data: { leadId: lead.id, author: "CONTACT", body: "Hola, ¿tienen parcelas en Pucón?" } });
  await runAgent(lead.id, fakeAnthropic([say("¡Hola Ana! Sí, ¿para cuándo buscas?")]).clients);
  return db.lead.findUniqueOrThrow({ where: { id: lead.id } });
}

/** Simula que pasó el tiempo: el seguimiento vence ahora. */
async function makeDue(leadId: string) {
  await db.lead.update({ where: { id: leadId }, data: { followUpAt: new Date(Date.now() - 1000) } });
}

describe("plazos y horario", () => {
  it("lee y escribe plazos", () => {
    expect(parseDelays("3h, 1d 30m;1.5h")).toEqual([180, 1440, 30, 90]);
    expect(parseDelays("3 horas")).toBeNull();
    expect([90, 180, 4320].map(formatDelay)).toEqual(["90m", "3h", "3d"]);
  });

  it("convierte fechas de Chile con y sin horario de verano", () => {
    expect(parseChileDateTime("2026-10-12 10:00")?.toISOString()).toBe("2026-10-12T13:00:00.000Z");
    expect(parseChileDateTime("2026-06-15 10:00")?.toISOString()).toBe("2026-06-15T14:00:00.000Z");
    expect(parseChileDateTime("2026-02-30 10:00")).toBeNull();
  });

  it("respeta el horario de envío en hora de Chile", () => {
    const s = { ...DEFAULT_FOLLOW_UPS, sendFrom: 9, sendTo: 21 };
    expect(withinSendingHours(s, new Date("2026-10-09T15:00:00Z"))).toBe(true); // 12:00
    expect(withinSendingHours(s, new Date("2026-10-09T03:00:00Z"))).toBe(false); // 00:00
  });
});

describe("seguimientos", () => {
  beforeEach(() => setSetting<AiConfig>("ai", { provider: "anthropic", model: "m", effort: "medium" }));

  it("al responder, la IA deja programado el primer seguimiento", async () => {
    await useFollowUps();
    const before = Date.now();
    const lead = await conversation();
    expect(lead.followUpCount).toBe(0);
    expect(lead.followUpAt!.getTime() - before).toBeGreaterThanOrEqual(3 * HOUR);
    expect(lead.followUpAt!.getTime() - Date.now()).toBeLessThanOrEqual(3 * HOUR);
  });

  it("desactivados, no se programa nada", async () => {
    const lead = await conversation();
    expect(lead.followUpAt).toBeNull();
  });

  it("envía el seguimiento vencido y programa el siguiente", async () => {
    await useFollowUps();
    const lead = await conversation();
    await makeDue(lead.id);

    const { clients, requests } = fakeAnthropic([say("Ana, ¿pudiste ver las opciones en Pucón?")]);
    expect(await runDueFollowUps({ clients })).toMatchObject({ sent: 1, skipped: 0 });

    expect(lastTurn(requests)).toContain("<seguimiento>");
    expect(lastTurn(requests)).toContain("seguimiento 1 de 4");
    const messages = await db.message.findMany({ where: { leadId: lead.id }, orderBy: { createdAt: "asc" } });
    expect(messages.at(-1)).toMatchObject({ author: "AI", body: "Ana, ¿pudiste ver las opciones en Pucón?" });
    const after = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.followUpCount).toBe(1);
    expect(after.followUpAt!.getTime() - Date.now()).toBeGreaterThan(23 * HOUR);
    expect(await db.leadEvent.count({ where: { leadId: lead.id, type: "FOLLOW_UP_SENT" } })).toBe(1);
    // El historial de la IA solo crece: el turno de seguimiento va al final.
    const transcript = await db.agentTranscript.findUniqueOrThrow({ where: { leadId: lead.id } });
    expect((transcript.messages as unknown[]).length).toBe(4);
  });

  it("si el cliente vuelve a escribir, la cuenta parte de cero", async () => {
    await useFollowUps();
    const lead = await conversation();
    await makeDue(lead.id);
    await runDueFollowUps(fakeAnthropic([say("¿Seguimos conversando?")]));
    await db.message.create({ data: { leadId: lead.id, author: "CONTACT", body: "Sí, perdón" } });
    await runAgent(lead.id, fakeAnthropic([say("¡Genial!")]).clients);
    const after = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.followUpCount).toBe(0);
    expect(after.followUpAt!.getTime() - Date.now()).toBeLessThanOrEqual(3 * HOUR);
  });

  it("tras el último plazo no hay más seguimientos", async () => {
    await useFollowUps({ delays: [60] });
    const lead = await conversation();
    await makeDue(lead.id);
    await runDueFollowUps(fakeAnthropic([say("¿Te puedo ayudar en algo más?")]));
    const after = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect([after.followUpCount, after.followUpAt]).toEqual([1, null]);
  });

  it("si la IA decide no escribir, no envía nada ni insiste", async () => {
    await useFollowUps();
    const lead = await conversation();
    await makeDue(lead.id);
    expect(await runDueFollowUps(fakeAnthropic([say("SIN_SEGUIMIENTO")]))).toMatchObject({ sent: 0, skipped: 1 });
    expect(await db.message.count({ where: { leadId: lead.id } })).toBe(2);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).followUpAt).toBeNull();
  });

  it("un error de la IA no le escribe al cliente ni pausa la IA", async () => {
    await useFollowUps();
    const lead = await conversation();
    await makeDue(lead.id);
    await runDueFollowUps(fakeAnthropic([]));
    expect(await db.message.count({ where: { leadId: lead.id } })).toBe(2);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).aiEnabled).toBe(true);
  });

  it("fuera del horario de envío espera", async () => {
    await useFollowUps({ sendFrom: 9, sendTo: 21 });
    const lead = await conversation();
    await makeDue(lead.id);
    const r = await runDueFollowUps({ now: new Date("2026-10-09T03:00:00Z"), ...fakeAnthropic([]) });
    expect(r).toMatchObject({ sent: 0, reason: "Fuera del horario de envío." });
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).followUpAt).not.toBeNull();
  });

  it("no hace seguimiento automático si un ejecutivo escribió último o la IA está pausada", async () => {
    await useFollowUps();
    const a = await conversation();
    await db.message.create({ data: { leadId: a.id, author: "USER", body: "Te llamo mañana" } });
    await makeDue(a.id);
    const b = await createLead({ name: "Bruno", channel: "SIMULATOR" });
    await db.message.create({ data: { leadId: b.id, author: "AI", body: "¿Sigues ahí?" } });
    await setAiEnabled(b.id, false, { actor: "SYSTEM" });
    await makeDue(b.id);

    const { clients, requests } = fakeAnthropic([]);
    expect(await runDueFollowUps({ clients })).toMatchObject({ sent: 0, skipped: 1 });
    expect(requests).toHaveLength(0);
  });

  it("dos revisiones simultáneas envían un solo seguimiento", async () => {
    await useFollowUps();
    const lead = await conversation();
    await makeDue(lead.id);
    const { clients } = fakeAnthropic([say("¿Hola?"), say("¿Hola?")]);
    await Promise.all([runDueFollowUps({ clients }), runDueFollowUps({ clients })]);
    expect(await db.message.count({ where: { leadId: lead.id, author: "AI" } })).toBe(2);
  });

  it("la IA agenda un recontacto, lo ve en el CRM y le escribe ese día", async () => {
    await useFollowUps();
    await seedFunnel();
    const lead = await createLead({ name: "Ana", channel: "SIMULATOR" });
    await db.message.create({ data: { leadId: lead.id, author: "CONTACT", body: "Visito la parcela el sábado, hablamos después" } });
    const date = new Date(Date.now() + 5 * 24 * HOUR).toISOString().slice(0, 10);
    await runAgent(
      lead.id,
      fakeAnthropic([
        toolUse("t1", "schedule_follow_up", { date: `${date} 11:00`, reason: "preguntar cómo le fue en la visita" }),
        say("¡Perfecto! Te escribo después de tu visita."),
      ]).clients,
    );
    let current = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(current.followUpReason).toBe("preguntar cómo le fue en la visita");
    expect(current.followUpAt).toEqual(parseChileDateTime(`${date} 11:00`));

    // Un nuevo mensaje del cliente no borra lo agendado, y la IA lo ve en el <crm_state>.
    await db.message.create({ data: { leadId: lead.id, author: "CONTACT", body: "Gracias" } });
    const turn = fakeAnthropic([say("¡A ti!")]);
    await runAgent(lead.id, turn.clients);
    expect(lastTurn(turn.requests)).toContain("Recontacto agendado:");
    current = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(current.followUpReason).toBe("preguntar cómo le fue en la visita");

    await makeDue(lead.id);
    const followUp = fakeAnthropic([say("Hola Ana, ¿cómo te fue en la visita?")]);
    await runDueFollowUps(followUp);
    expect(lastTurn(followUp.requests)).toContain("Agendaste este recontacto: preguntar cómo le fue en la visita");
    current = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    // Después del recontacto sigue la secuencia automática.
    expect([current.followUpReason, current.followUpCount]).toEqual([null, 0]);
    expect(current.followUpAt).not.toBeNull();
  });

  it("con fecha vacía la IA cancela los seguimientos", async () => {
    await useFollowUps();
    await seedFunnel();
    const lead = await createLead({ name: "Ana", channel: "SIMULATOR" });
    await db.message.create({ data: { leadId: lead.id, author: "CONTACT", body: "Ya compré en otro lado, no me escriban" } });
    await runAgent(
      lead.id,
      fakeAnthropic([toolUse("t1", "schedule_follow_up", { date: "", reason: "ya compró" }), say("Entendido, ¡éxito!")]).clients,
    );
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).followUpAt).toBeNull();
  });

  it("el botón del lead envía el seguimiento sin esperar el plazo", async () => {
    await useFollowUps();
    const lead = await conversation();
    expect(await sendFollowUpNow(lead.id, fakeAnthropic([say("¿Te ayudo con algo más?")]).clients)).toBe("sent");
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).followUpCount).toBe(1);
  });
});
