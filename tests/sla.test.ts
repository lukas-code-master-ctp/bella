import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { parseLocalDateTime } from "@/lib/dates";
import { createLead, dismissReply, moveStage, setAiEnabled, setAssignee } from "@/lib/domain/leads";
import { businessMs, DEFAULT_SLA, getSlaReport, lateLeads, notifyLateWaits, pendingWaits, reassignLateWaits, saveSlaSettings, waitsOf, type LeadHistory, type SlaSettings } from "@/lib/domain/sla";
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
    expect(waitsOf(history(items), HUMAN)).toEqual([{ leadId: "L", kind: "first", startedAt: at(20), answeredAt: null, reassignedAt: null, assigneeId: null }]);
    expect(waitsOf(history(items, { status: "LOST" }), HUMAN)).toEqual([]);
  });

  it("si una persona pasa el lead a humano, solo espera respuesta cuando el cliente la esperaba", () => {
    const quiet = [ev("CREATED", 0, { stage: "Nuevo" }), msg("CONTACT", 0), msg("AI", 1), ev("AI_PAUSED", 5, {}, "USER")];
    expect(waitsOf(history(quiet), HUMAN)).toEqual([]);
    const pending = [ev("CREATED", 0, { stage: "Nuevo" }), msg("CONTACT", 0), ev("AI_PAUSED", 5, {}, "USER"), msg("USER", 9, "ana")];
    expect(waitsOf(history(pending), HUMAN).map((w) => [w.kind, w.startedAt, w.answeredAt])).toEqual([["reply", at(5), at(9)]]);
  });

  it("'No requiere respuesta' cierra la espera como atendida y un mensaje nuevo abre otra", () => {
    const waits = waitsOf(
      history([
        ev("CREATED", 0, { stage: "Atención humana" }),
        ev("ASSIGNED", 0, { assigneeId: "ana" }),
        msg("USER", 5, "ana"),
        msg("CONTACT", 10),
        ev("NO_REPLY_NEEDED", 25, {}, "USER"),
        msg("CONTACT", 60),
      ]),
      HUMAN,
    );
    expect(waits.map((w) => [w.kind, w.startedAt, w.answeredAt])).toEqual([
      ["first", at(0), at(5)],
      ["reply", at(10), at(25)],
      ["reply", at(60), null],
    ]);
  });

  it("marcar 'No requiere respuesta' saca al lead de los que esperan y agenda retomar", async () => {
    const [, , , human] = await seedFunnel();
    const ana = await executive("Ana");
    const lead = await createLead({ name: "Juan", channel: "WHATSAPP", externalId: "1" });
    await setAssignee(lead.id, ana.id, { actor: "SYSTEM" });
    await moveStage(lead.id, human.id, { actor: "AI" });
    await db.message.create({ data: { leadId: lead.id, author: "CONTACT", body: "Gracias, saludos", createdAt: new Date(Date.now() - 5 * MIN) } });
    expect((await pendingWaits(allDay)).some((w) => w.leadId === lead.id)).toBe(true);

    const resumeAt = new Date(Date.now() + 30 * 24 * 60 * MIN);
    await dismissReply(lead.id, { actor: "USER", userId: ana.id }, { resumeAt, notes: "Quiere visitar en diciembre" });

    expect((await pendingWaits(allDay)).some((w) => w.leadId === lead.id)).toBe(false);
    const saved = await db.lead.findUniqueOrThrow({ where: { id: lead.id }, include: { tasks: true } });
    expect(saved.noReplyNeededAt).not.toBeNull();
    expect(saved.tasks.map((t) => [t.title, t.notes, t.dueAt.getTime(), t.assigneeId])).toEqual([["Retomar contacto", "Quiere visitar en diciembre", resumeAt.getTime(), ana.id]]);
    await expect(dismissReply(lead.id, { actor: "USER" }, { resumeAt: new Date(Date.now() - MIN) })).rejects.toThrow("fecha futura");
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

  it("avisa al ejecutivo al pasar la meta y a los admins al doble, una vez por espera", async () => {
    const [, , , human] = await seedFunnel();
    await saveSlaSettings({ hoursEnabled: false });
    const ana = await executive("Ana");
    const admin = await db.user.create({ data: { name: "Admin", email: "admin@test.cl", passwordHash: "x", role: "ADMIN" } });
    const lead = await createLead({ name: "Cliente", channel: "WHATSAPP", externalId: "1" });
    await setAssignee(lead.id, ana.id, { actor: "SYSTEM" });
    await moveStage(lead.id, human.id, { actor: "AI" });
    await db.notification.deleteMany();
    const now = Date.now();

    expect(await notifyLateWaits(new Date(now + 10 * MIN))).toEqual({ notified: 0 });
    expect((await lateLeads([lead.id], new Date(now + 10 * MIN))).size).toBe(0);

    expect(await notifyLateWaits(new Date(now + 20 * MIN))).toEqual({ notified: 1 });
    expect(await notifyLateWaits(new Date(now + 25 * MIN))).toEqual({ notified: 0 });
    expect((await lateLeads([lead.id], new Date(now + 20 * MIN))).get(lead.id)).toBeGreaterThan(15 * MIN);
    let notes = await db.notification.findMany({ orderBy: { createdAt: "asc" } });
    expect(notes.map((n) => [n.userId, n.type])).toEqual([[ana.id, "SLA_LATE"]]);
    expect(notes[0].body).toMatch(/^Lleva 20 min esperando la primera respuesta \(meta: 15 min\)$/);

    expect(await notifyLateWaits(new Date(now + 31 * MIN))).toEqual({ notified: 1 });
    notes = await db.notification.findMany({ where: { userId: admin.id } });
    expect(notes.map((n) => n.body)).toEqual(["Atrasado: 31 min sin respuesta de Ana (meta: 15 min)"]);

    // Ana responde: ya no está atrasado.
    await db.message.create({ data: { leadId: lead.id, author: "USER", userId: ana.id, body: "Hola", createdAt: new Date(now + 32 * MIN) } });
    expect((await lateLeads([lead.id], new Date(now + 40 * MIN))).size).toBe(0);
    expect(await notifyLateWaits(new Date(now + 40 * MIN))).toEqual({ notified: 0 });

    await saveSlaSettings({ alerts: false });
    await db.message.create({ data: { leadId: lead.id, author: "CONTACT", body: "?", createdAt: new Date(now + 41 * MIN) } });
    expect(await notifyLateWaits(new Date(now + 200 * MIN))).toEqual({ notified: 0 });
  });

  it("al reasignar sin respuesta, la espera cuenta para quien lo tenía y parte de cero para el nuevo", () => {
    const waits = waitsOf(
      history([
        ev("CREATED", 0, { stage: "Nuevo" }),
        ev("ASSIGNED", 0, { assigneeId: "ana" }),
        ev("AI_PAUSED", 5, {}, "AI"),
        ev("ASSIGNED", 65, { assigneeId: "beto" }),
        msg("USER", 70, "beto"),
      ]),
      HUMAN,
    );
    expect(waits.map((w) => [w.kind, w.startedAt, w.answeredAt, w.reassignedAt, w.assigneeId])).toEqual([
      ["first", at(5), null, at(65), "ana"],
      ["first", at(65), at(70), null, "beto"],
    ]);
  });

  it("reasigna al ejecutivo con menos carga si no responde en el plazo, solo si está activado", async () => {
    const [, , , human] = await seedFunnel();
    await saveSlaSettings({ hoursEnabled: false, alerts: false, reassignMinutes: 60 });
    const ana = await executive("Ana");
    const beto = await executive("Beto");
    const lead = await createLead({ name: "Cliente", channel: "WHATSAPP", externalId: "1" });
    await setAssignee(lead.id, ana.id, { actor: "SYSTEM" });
    await moveStage(lead.id, human.id, { actor: "AI" });
    const now = Date.now();
    const assignee = async () => (await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).assigneeId;

    expect(await reassignLateWaits(new Date(now + 90 * MIN))).toEqual({ reassigned: 0 });
    await saveSlaSettings({ reassign: true });
    expect(await reassignLateWaits(new Date(now + 30 * MIN))).toEqual({ reassigned: 0 });
    expect(await reassignLateWaits(new Date(now + 61 * MIN))).toEqual({ reassigned: 1 });
    expect(await assignee()).toBe(beto.id);
    const event = await db.leadEvent.findFirstOrThrow({ where: { leadId: lead.id, type: "ASSIGNED" }, orderBy: { createdAt: "desc" } });
    expect(event.reason).toBe("Sin primera respuesta en 1 h de Ana");
    // El cron corrió a los 61 minutos.
    await db.leadEvent.update({ where: { id: event.id }, data: { createdAt: new Date(now + 61 * MIN) } });

    // Beto acaba de recibirlo: su plazo parte ahora. Después no queda nadie que no lo haya tenido.
    expect(await reassignLateWaits(new Date(now + 62 * MIN))).toEqual({ reassigned: 0 });
    expect(await reassignLateWaits(new Date(now + 130 * MIN))).toEqual({ reassigned: 0 });
    expect(await assignee()).toBe(beto.id);

    // En el SLA, a Ana le cuenta como fuera de meta y Beto sigue esperando.
    const report = await getSlaReport({ from: new Date(now - MIN), to: new Date(now + 120 * MIN) }, { ...allDay, reassign: true }, new Date(now + 70 * MIN));
    expect(report.byExecutive.map((r) => [r.label, r.first.count, r.first.met, r.reassigned, r.waiting])).toEqual([
      ["Ana", 1, 0, 1, 0],
      ["Beto", 0, 0, 0, 1],
    ]);
  });
});
