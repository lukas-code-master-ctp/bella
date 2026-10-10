import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { closeLead, createLead } from "@/lib/domain/leads";
import { setSetting } from "@/lib/settings";
import type { AiConfig } from "@/lib/ai/config";
import type { ChatClient } from "@/lib/ai/providers";
import { hasUnseenInsight, lastWeekPeriod, parseReport, runWeeklyInsight } from "@/lib/ai/weekly-insights";
import { executive, seedFunnel } from "./factories";

function fakeOpenRouter(content: string) {
  const requests: { model: string; messages: { role: string; content: string }[] }[] = [];
  const client: ChatClient = {
    async complete(body) {
      requests.push(structuredClone(body) as (typeof requests)[number]);
      return { model: "x", choices: [{ finish_reason: "stop", message: { role: "assistant", content } }] };
    },
  };
  return { clients: { openrouter: client }, requests };
}

const REPLY = JSON.stringify({
  resumen: "Semana con buen interés en financiamiento.",
  loQuePiden: ["Financiamiento directo", "  Precios   por m2 "],
  problemasEmbudo: ["Leads que no responden después de la cotización"],
  fortalezas: [],
  oportunidades: ["Campaña de Ovalle trae leads calificados"],
  recomendaciones: ["Llamar a los cotizados sin respuesta"],
});

describe("insights semanales", () => {
  it("resume la semana pasada con el modelo principal y avisa a los admins", async () => {
    await setSetting<AiConfig>("ai", { provider: "openrouter", model: "grande", effort: "high", summaryModel: "chico" });
    await seedFunnel();
    const admin = await db.user.create({ data: { name: "Admin", email: "a@test.cl", passwordHash: "x", role: "ADMIN" } });
    const exec = await executive("Eva");
    const now = new Date("2026-10-12T12:00:00Z"); // lunes 9:00 en Chile
    const { from, to } = lastWeekPeriod(now);
    expect(to.toISOString()).toBe("2026-10-12T03:00:00.000Z");
    expect(from.toISOString()).toBe("2026-10-05T03:00:00.000Z");

    const ana = await createLead({ name: "Ana Pérez", channel: "WHATSAPP", phone: "+56911112222", externalId: "1" });
    await db.lead.update({ where: { id: ana.id }, data: { createdAt: new Date("2026-10-08T15:00:00Z"), aiSummary: "Pidió financiamiento.", score: 70 } });
    await db.message.create({
      data: { leadId: ana.id, author: "CONTACT", body: "¿Tienen financiamiento directo?", createdAt: new Date("2026-10-08T15:00:00Z") },
    });
    // Fuera del período y del simulador: no entran.
    const old = await createLead({ name: "Viejo", channel: "WHATSAPP", externalId: "2" });
    await db.lead.update({ where: { id: old.id }, data: { createdAt: new Date("2026-09-01T12:00:00Z") } });
    await db.message.create({ data: { leadId: old.id, author: "CONTACT", body: "mensaje antiguo", createdAt: new Date("2026-09-01T12:00:00Z") } });
    const sim = await createLead({ name: "Sim", channel: "SIMULATOR" });
    await db.message.create({ data: { leadId: sim.id, author: "CONTACT", body: "prueba simulador", createdAt: new Date("2026-10-08T15:00:00Z") } });
    await closeLead(ana.id, "LOST", { actor: "USER", userId: exec.id }, { lostReason: "Sin presupuesto" });
    await db.lead.update({ where: { id: ana.id }, data: { createdAt: new Date("2026-10-08T15:00:00Z") } });

    const { clients, requests } = fakeOpenRouter("```json\n" + REPLY + "\n```");
    expect(await runWeeklyInsight(now, clients)).toMatchObject({ created: true, insightId: expect.any(String) });

    expect(requests[0].model).toBe("grande");
    const input = requests[0].messages[1].content;
    expect(input).toContain("Leads nuevos: 1 (abiertos 0, ganados 0, perdidos 1)");
    expect(input).toContain("Sin presupuesto (1)");
    expect(input).toContain('"¿Tienen financiamiento directo?"');
    expect(input).toContain("Resumen: Pidió financiamiento.");
    expect(input).not.toContain("mensaje antiguo");
    expect(input).not.toContain("prueba simulador");
    expect(input).not.toContain("Ana Pérez");

    const saved = await db.weeklyInsight.findFirstOrThrow();
    expect(saved.report).toMatchObject({ asks: ["Financiamiento directo", "Precios por m2"], strengths: [] });
    expect(saved.stats).toMatchObject({ leads: 1, lost: 1, activeLeads: 1 });
    expect(await hasUnseenInsight(admin.id)).toBe(true);

    // El cron no lo repite para la misma semana.
    expect(await runWeeklyInsight(now, clients)).toEqual({ created: false, insightId: null });
    expect(requests).toHaveLength(1);
  });

  it("rechaza respuestas sin JSON válido", () => {
    expect(parseReport("no sé")).toBeNull();
    expect(parseReport('{"loQuePiden": []}')).toBeNull();
    expect(parseReport('{"resumen": "ok"}')).toMatchObject({ summary: "ok", asks: [], recommendations: [] });
  });
});
