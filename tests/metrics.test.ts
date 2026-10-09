import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { closeLead, createLead, moveStage } from "@/lib/domain/leads";
import { formatDuration, getMetrics } from "@/lib/domain/metrics";
import { executive, seedFunnel } from "./factories";

const MIN = 60_000;

async function messages(leadId: string, list: [author: "CONTACT" | "AI" | "USER", minute: number, userId?: string][]) {
  const base = Date.now() - 60 * MIN;
  for (const [author, minute, userId] of list) {
    await db.message.create({ data: { leadId, author, userId, body: "x", createdAt: new Date(base + minute * MIN) } });
  }
}

describe("Métricas", () => {
  it("cuenta leads por canal, campaña, embudo, respuesta, ejecutivo y motivos de pérdida", async () => {
    const [, calificado, cotizacion] = await seedFunnel();
    const ana = await executive("Ana");
    const beto = await executive("Beto");

    const a = await createLead({ name: "A", channel: "WHATSAPP", externalId: "1" });
    const b = await createLead({ name: "B", channel: "WHATSAPP", externalId: "2" });
    const c = await createLead({ name: "C", channel: "INSTAGRAM", externalId: "3" });
    await createLead({ name: "Prueba", channel: "SIMULATOR" });

    await db.leadSource.create({ data: { leadId: a.id, kind: "AD", adId: "1", campaignName: "Parcelas Sur" } });
    await db.leadSource.create({ data: { leadId: b.id, kind: "LINK", utmSource: "google", utmCampaign: "Parcelas Sur" } });

    // A pasó por Cotización y volvió a Calificado; B llegó a Calificado; C sigue en Nuevo.
    await moveStage(a.id, cotizacion.id, { actor: "AI" });
    await moveStage(a.id, calificado.id, { actor: "USER" });
    await moveStage(b.id, calificado.id, { actor: "AI" });

    await db.lead.update({ where: { id: a.id }, data: { assigneeId: ana.id } });
    await db.lead.update({ where: { id: b.id }, data: { assigneeId: beto.id } });
    await closeLead(a.id, "WON", { actor: "USER" }, { amount: 39_000_000 });
    await closeLead(b.id, "LOST", { actor: "USER" }, { lostReason: "Sin presupuesto" });

    await messages(a.id, [["CONTACT", 0], ["AI", 1], ["USER", 10, ana.id]]);
    await messages(b.id, [["AI", 0], ["CONTACT", 5], ["USER", 35, beto.id]]);
    await messages(c.id, [["CONTACT", 0]]);

    const m = await getMetrics({ from: new Date(Date.now() - 86_400_000), to: new Date() });

    expect(m.totals).toEqual({ leads: 3, open: 1, won: 1, lost: 1, amount: 39_000_000 });
    expect(m.byChannel.map((r) => [r.key, r.leads, r.won])).toEqual([
      ["WHATSAPP", 2, 1],
      ["INSTAGRAM", 1, 0],
    ]);
    expect(m.byCampaign.map((r) => [r.label, r.leads, r.won, r.lost])).toEqual([
      ["Parcelas Sur", 2, 1, 1],
      ["Directo (sin anuncio ni UTM)", 1, 0, 0],
    ]);
    expect(m.funnel.map((s) => [s.name, s.reached, s.current])).toEqual([
      ["Nuevo", 3, 1],
      ["Calificado", 2, 2],
      ["Cotización", 1, 0],
      ["Atención humana", 0, 0],
    ]);
    // A: 1 min (IA) y 10 min (equipo). B: 30 min (equipo, desde el primer mensaje del cliente). C: sin respuesta.
    expect([m.firstReply.count, m.firstReply.medianMs, m.firstReply.p90Ms]).toEqual([2, 1 * MIN, 30 * MIN]);
    expect([m.firstHumanReply.count, m.firstHumanReply.medianMs, m.firstReply.within5m]).toEqual([2, 10 * MIN, 1]);
    expect(m.byExecutive.map((r) => [r.label, r.leads, r.won, r.lost, r.firstReplyMs])).toEqual([
      ["Ana", 1, 1, 0, 10 * MIN],
      ["Beto", 1, 0, 1, 30 * MIN],
      ["Sin asignar", 1, 0, 0, null],
    ]);
    expect(m.lostReasons).toEqual([{ reason: "Sin presupuesto", count: 1 }]);

    const own = await getMetrics({ from: new Date(Date.now() - 86_400_000), to: new Date(), assigneeId: ana.id });
    expect(own.totals.leads).toBe(1);
  });

  it("formatea duraciones", () => {
    expect([45_000, 12 * MIN, 200 * MIN, 52 * 60 * MIN, null].map(formatDuration)).toEqual(["45 s", "12 min", "3 h 20 min", "2 d 4 h", "—"]);
  });
});
