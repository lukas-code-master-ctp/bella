import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { parseLocalDateTime } from "@/lib/dates";
import { createLead, moveStage, setAiEnabled, setAssignee } from "@/lib/domain/leads";
import { businessMs, DEFAULT_SLA, getSlaReport, pendingWaits, waitsOf, type LeadHistory, type SlaSettings } from "@/lib/domain/sla";
import { executive, seedFunnel } from "./factories";

const MIN = 60_000;
const T0 = new Date("2026-10-20T15:00:00Z");
const at = (minute: number) => new Date(T0.getTime() + minute * MIN);
const HUMAN = new Set(["Atención humana"]);

function history(items: (LeadHistory["events"][number] | LeadHistory["messages"][number])[], extra: Partial<LeadHistory> = {}): LeadHistory {
  return {
    id: "L",
    status: "OPEN",
    assigneeId: null,
    events: items.filter((i): i is LeadHistory["events"][number] => "type" in i),
    messages: items.filter((i): i is LeadHistory["messages"][number] => "author" in i),
    ...extra,
  };
}
const ev = (type: string, minute: number, data: object = {}, actor = "SYSTEM") => ({ type, actor, data, createdAt: at(minute) });
const msg = (author: "CONTACT" | "AI" | "USER", minute: number, userId: string | null = null) => ({ author, userId, createdAt: at(minute) });

const allDay: SlaSettings = { ...DEFAULT_SLA, hoursEnabled: false };

describe("SLA de ejecutivos", () => {
  it("mide la primera respuesta desde la derivación y las siguientes desde cada mensaje del cliente", () => {
    const waits = waitsOf(
      history([
        ev("CREATED", 0, { stage: "Nuevo" }),
        msg("CONTACT", 0),
        msg("AI", 1),
        msg("CONTACT", 2),
        ev("STAGE_CHANGED", 3, { from: "Nuevo", to: "Atención humana" }, "AI"),
        ev("ASSIGNED", 3, { assigneeId: "ana" }),
        msg("AI", 3),
        msg("USER", 20, "ana"),
        msg("CONTACT", 30),
        msg("CONTACT", 31),
        msg("USER", 40, "beto"),
        msg("CONTACT", 50),
      ]),
      HUMAN,
    );
    expect(waits.map((w) => [w.kind, w.startedAt, w.answeredAt, w.assigneeId])).toEqual([
      ["first", at(3), at(20), "ana"],
      ["reply", at(30), at(40), "ana"],
      // Sigue esperando: cuenta para el ejecutivo actual del lead.
      ["reply", at(50), null, null],
    ]);
  });

  it("no mide mientras atiende la IA y descarta la espera si el lead vuelve a la IA o se cierra", () => {
    const items = [
      ev("CREATED", 0, { stage: "Nuevo" }),
      msg("CONTACT", 0),
      msg("AI", 1),
      ev("AI_PAUSED", 5, {}, "AI"),
      ev("AI_RESUMED", 10, {}, "USER"),
      msg("CONTACT", 12),
      ev("AI_PAUSED", 20, {}, "AI"),
    ];
    expect(waitsOf(history(items), HUMAN)).toEqual([{ leadId: "L", kind: "first", startedAt: at(20), answeredAt: null, assigneeId: null }]);
    expect(waitsOf(history(items, { status: "LOST" }), HUMAN)).toEqual([]);
  });

  it("si una persona pasa el lead a humano, solo espera respuesta cuando el cliente la esperaba", () => {
    const quiet = [ev("CREATED", 0, { stage: "Nuevo" }), msg("CONTACT", 0), msg("AI", 1), ev("AI_PAUSED", 5, {}, "USER")];
    expect(waitsOf(history(quiet), HUMAN)).toEqual([]);
    const pending = [ev("CREATED", 0, { stage: "Nuevo" }), msg("CONTACT", 0), ev("AI_PAUSED", 5, {}, "USER"), msg("USER", 9, "ana")];
    expect(waitsOf(history(pending), HUMAN).map((w) => [w.kind, w.startedAt, w.answeredAt])).toEqual([["reply", at(5), at(9)]]);
  });

  it("cuenta solo el tiempo dentro del horario laboral", () => {
    const office: SlaSettings = { ...DEFAULT_SLA, hoursEnabled: true, days: [1, 2, 3, 4, 5], from: 9, to: 19 };
    // Viernes 18:30 a lunes 9:15 (hora de Chile): 30 min el viernes y 15 el lunes.
    const fri = parseLocalDateTime("2026-10-23 18:30")!;
    const mon = parseLocalDateTime("2026-10-26 09:15")!;
    expect(businessMs(office, fri, mon)).toBe(45 * MIN);
    expect(businessMs(allDay, fri, mon)).toBe(mon.getTime() - fri.getTime());
  });

  it("reporta el cumplimiento por ejecutivo y los leads que esperan ahora", async () => {
    const [, , , human] = await seedFunnel();
    const ana = await executive("Ana");
    const beto = await executive("Beto");
    const a = await createLead({ name: "A", channel: "WHATSAPP", externalId: "1" });
    const b = await createLead({ name: "B", channel: "WHATSAPP", externalId: "2" });
    const sim = await createLead({ name: "Prueba", channel: "SIMULATOR" });
    for (const lead of [a, b, sim]) {
      await setAssignee(lead.id, lead.id === b.id ? beto.id : ana.id, { actor: "SYSTEM" });
      await moveStage(lead.id, human.id, { actor: "AI" });
    }
    const now = Date.now();
    // Ana responde a A en 5 minutos; luego el cliente escribe y Ana tarda 50 (meta: 30).
    await db.message.createMany({
      data: [
        { leadId: a.id, author: "USER", userId: ana.id, body: "x", createdAt: new Date(now + 5 * MIN) },
        { leadId: a.id, author: "CONTACT", body: "x", createdAt: new Date(now + 10 * MIN) },
        { leadId: a.id, author: "USER", userId: ana.id, body: "x", createdAt: new Date(now + 60 * MIN) },
        { leadId: sim.id, author: "USER", userId: ana.id, body: "x", createdAt: new Date(now + 99 * MIN) },
      ],
    });
    // B: Beto aún no responde; a los 20 minutos pasó su meta de 15.
    const later = new Date(now + 20 * MIN);
    const report = await getSlaReport({ from: new Date(now - 60 * MIN), to: new Date(now + 120 * MIN) }, allDay, later);

    expect(report.first).toMatchObject({ count: 1, met: 1 });
    expect(report.reply).toMatchObject({ count: 1, met: 0, maxMs: 50 * MIN });
    expect(report.byExecutive.map((r) => [r.label, r.first.count, r.reply.count, r.waiting, r.overdue])).toEqual([
      ["Ana", 1, 1, 0, 0],
      ["Beto", 0, 0, 1, 1],
    ]);
    expect(report.waiting.map((w) => [w.contactName, w.kind, w.assigneeName])).toEqual([["B", "first", "Beto"]]);

    // El ejecutivo ve solo lo suyo.
    const mine = await getSlaReport({ from: new Date(now - 60 * MIN), to: new Date(now + 120 * MIN), assigneeId: beto.id }, allDay, later);
    expect(mine.byExecutive.map((r) => r.label)).toEqual(["Beto"]);

    // Reactivar la IA saca al lead de la espera.
    await moveStage(b.id, (await db.stage.findFirstOrThrow({ where: { name: "Nuevo" } })).id, { actor: "USER" });
    await setAiEnabled(b.id, true, { actor: "USER" });
    expect(await pendingWaits(allDay, later)).toEqual([]);
  });
});
