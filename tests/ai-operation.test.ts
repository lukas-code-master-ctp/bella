import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createLead } from "@/lib/domain/leads";
import { setSetting } from "@/lib/settings";
import { runAgent } from "@/lib/ai/agent";
import { answerWaitingLeads } from "@/lib/ai/respond";
import { runDueFollowUps } from "@/lib/ai/follow-ups";
import type { AiConfig } from "@/lib/ai/config";
import type { AnthropicClient } from "@/lib/ai/providers";
import {
  DEFAULT_AI_OPERATION,
  describeHours,
  saveAiOperation,
  withinBusinessHours,
  type AiOperationSettings,
} from "@/lib/domain/ai-operation";
import { seedFunnel } from "./factories";

/** Cliente falso de Anthropic: responde siempre el mismo texto y registra las solicitudes. */
function fakeAnthropic(reply = "¡Hola! ¿En qué te ayudo?") {
  const requests: { messages: { role: string; content: { type: string; text?: string }[] }[] }[] = [];
  const client = {
    beta: {
      messages: {
        create: async (req: (typeof requests)[number]) => {
          requests.push(structuredClone(req));
          return {
            id: "msg",
            type: "message",
            role: "assistant",
            model: "x",
            usage: {},
            stop_reason: "end_turn",
            content: [{ type: "text", text: reply }],
          };
        },
      },
    },
  } as unknown as AnthropicClient;
  return { clients: { anthropic: client }, requests };
}

const lastUserText = (req: { messages: { content: { type: string; text?: string }[] }[] }) =>
  req.messages[req.messages.length - 1].content.map((c) => c.text ?? "").join("\n");

async function whatsappLead(name = "Ana") {
  // Sin externalId: deliverOutbound no llama a Meta en las pruebas.
  return createLead({ name, channel: "WHATSAPP", phone: "+56911112222" });
}

async function inbound(leadId: string, body: string, createdAt = new Date()) {
  await db.message.create({ data: { leadId, author: "CONTACT", body, createdAt } });
}

beforeEach(async () => {
  await setSetting<AiConfig>("ai", { provider: "anthropic", model: "modelo-x", effort: "medium" });
  await seedFunnel();
});

describe("horario de atención", () => {
  const hours: AiOperationSettings = { ...DEFAULT_AI_OPERATION, hoursEnabled: true, days: [1, 2, 3, 4, 5], from: 9, to: 19 };

  it("respeta días y horas en hora de Chile", () => {
    // Lunes 12-10-2026: Chile está en UTC-3.
    expect(withinBusinessHours(hours, new Date("2026-10-12T13:00:00Z"))).toBe(true); // 10:00
    expect(withinBusinessHours(hours, new Date("2026-10-12T22:30:00Z"))).toBe(false); // 19:30
    expect(withinBusinessHours(hours, new Date("2026-10-17T13:00:00Z"))).toBe(false); // sábado
    expect(withinBusinessHours({ ...hours, hoursEnabled: false }, new Date("2026-10-17T13:00:00Z"))).toBe(true);
    expect(describeHours(hours)).toBe("Lunes a viernes, de 9:00 a 19:00");
  });

  it("un horario nocturno pertenece al día en que empieza", () => {
    const night = { ...hours, days: [5], from: 20, to: 2 };
    expect(withinBusinessHours(night, new Date("2026-10-16T23:30:00Z"))).toBe(true); // viernes 20:30
    expect(withinBusinessHours(night, new Date("2026-10-17T04:00:00Z"))).toBe(true); // sábado 01:00
    expect(withinBusinessHours(night, new Date("2026-10-18T04:00:00Z"))).toBe(false); // domingo 01:00
  });

  it("fuera de horario manda el mensaje automático una vez y responde lo pendiente al abrir", async () => {
    await setSetting("channels", { whatsappAi: true });
    // Sin días de atención: siempre cerrado.
    await saveAiOperation({ hoursEnabled: true, days: [], outOfHours: "message", outOfHoursMessage: "Volvemos el lunes." });
    const lead = await whatsappLead();
    const { clients, requests } = fakeAnthropic("Hola Ana, te cuento…");

    await inbound(lead.id, "Hola, ¿siguen atendiendo?");
    expect(await runAgent(lead.id, clients)).toBe("skipped");
    await inbound(lead.id, "¿Hola?");
    await runAgent(lead.id, clients);
    expect(requests).toHaveLength(0);
    const auto = await db.message.findMany({ where: { leadId: lead.id, author: "AI" } });
    expect(auto.map((m) => m.body)).toEqual(["Volvemos el lunes."]);

    await saveAiOperation({ hoursEnabled: false });
    expect(await answerWaitingLeads({ clients })).toBe(1);
    // La primera solicitud es la respuesta; la siguiente, el resumen del lead.
    const context = lastUserText(requests[0]);
    expect(context).toContain("¿Hola?");
    expect(context).toContain('le respondió automáticamente: "Volvemos el lunes."');
    expect(await db.message.count({ where: { leadId: lead.id, author: "AI" } })).toBe(2);
    // Ya respondido: no se vuelve a tomar.
    expect(await answerWaitingLeads({ clients })).toBe(0);
  });

  it("en modo silencioso no escribe nada fuera de horario", async () => {
    await saveAiOperation({ hoursEnabled: true, days: [], outOfHours: "silent" });
    const lead = await whatsappLead();
    await inbound(lead.id, "Hola");
    const { clients, requests } = fakeAnthropic();
    await runAgent(lead.id, clients);
    expect(requests).toHaveLength(0);
    expect(await db.message.count({ where: { author: "AI" } })).toBe(0);
  });
});

describe("apagado general", () => {
  it("la IA no responde en canales reales, pero sí en el simulador", async () => {
    await saveAiOperation({ paused: true });
    const { clients, requests } = fakeAnthropic();
    const wa = await whatsappLead();
    await inbound(wa.id, "Hola");
    expect(await runAgent(wa.id, clients)).toBe("skipped");
    expect(requests).toHaveLength(0);

    const sim = await createLead({ name: "Prueba", channel: "SIMULATOR" });
    await inbound(sim.id, "Hola");
    expect(await runAgent(sim.id, clients)).toBe("sent");
  });

  it("no corre seguimientos ni responde pendientes mientras está apagada", async () => {
    await setSetting("channels", { whatsappAi: true });
    await setSetting("followUps", { enabled: true, sendFrom: 0, sendTo: 24 });
    await saveAiOperation({ paused: true });
    const lead = await whatsappLead();
    await inbound(lead.id, "Hola");
    const { clients, requests } = fakeAnthropic();
    expect((await runDueFollowUps({ clients })).reason).toMatch(/apagada/);
    expect(await answerWaitingLeads({ clients })).toBe(0);
    await saveAiOperation({ paused: false });
    expect(await answerWaitingLeads({ clients })).toBe(1);
    expect(await db.message.count({ where: { leadId: lead.id, author: "AI" } })).toBe(1);
  });
});

describe("tickets anteriores", () => {
  it("la IA ve cómo terminaron los tickets cerrados del contacto", async () => {
    const first = await createLead({ name: "Ana", channel: "SIMULATOR" });
    await db.lead.update({
      where: { id: first.id },
      data: { status: "LOST", lostReason: "Sin presupuesto", closedAt: new Date("2026-05-02T15:00:00Z"), aiSummary: "Buscaba algo más barato." },
    });
    const second = await createLead({ contactId: first.contactId });
    await db.lead.update({ where: { id: second.id }, data: { status: "WON", amount: 1500000, closedAt: new Date("2026-08-10T15:00:00Z") } });
    const current = await createLead({ contactId: first.contactId });
    await inbound(current.id, "Hola de nuevo");

    const { clients, requests } = fakeAnthropic();
    await runAgent(current.id, clients);
    const context = lastUserText(requests[0]);
    expect(context).toContain("Tickets anteriores del contacto");
    expect(context).toMatch(/10-08-2026: ganado por 1\.500\.000/);
    expect(context).toMatch(/02-05-2026: perdido \(Sin presupuesto\).*Buscaba algo más barato\./);
    expect(context.indexOf("ganado")).toBeLessThan(context.indexOf("perdido"));
  });

  it("se puede desactivar", async () => {
    await saveAiOperation({ previousTickets: false });
    const first = await createLead({ name: "Ana", channel: "SIMULATOR" });
    await db.lead.update({ where: { id: first.id }, data: { status: "LOST", closedAt: new Date() } });
    const current = await createLead({ contactId: first.contactId });
    await inbound(current.id, "Hola");
    const { clients, requests } = fakeAnthropic();
    await runAgent(current.id, clients);
    expect(lastUserText(requests[0])).not.toContain("Tickets anteriores");
  });
});
