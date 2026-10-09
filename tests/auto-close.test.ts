import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { runAutoClose } from "@/lib/domain/auto-close";
import { createLead, moveStage } from "@/lib/domain/leads";
import { setSetting } from "@/lib/settings";
import { seedFunnel } from "./factories";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date();
const ago = (days: number) => new Date(now.getTime() - days * DAY);

/** Lead cuya última actividad fue hace `days` días; `lastAuthor` escribió el último mensaje. */
async function leadInactiveFor(days: number, lastAuthor?: "CONTACT" | "AI" | "USER") {
  const lead = await createLead({ name: "Cliente", channel: "SIMULATOR" });
  await db.lead.update({ where: { id: lead.id }, data: { createdAt: ago(days + 1) } });
  await db.leadEvent.updateMany({ where: { leadId: lead.id }, data: { createdAt: ago(days + 1) } });
  if (lastAuthor) {
    await db.message.create({ data: { leadId: lead.id, author: lastAuthor, body: "hola", createdAt: ago(days) } });
  }
  return lead;
}

const status = async (id: string) => db.lead.findUniqueOrThrow({ where: { id } });

describe("cierre automático por inactividad", () => {
  it("no hace nada si está desactivado", async () => {
    await seedFunnel();
    const lead = await leadInactiveFor(30, "AI");
    expect(await runAutoClose(now)).toBe(0);
    expect((await status(lead.id)).status).toBe("OPEN");
  });

  it("cierra como perdido con el motivo configurado tras los días sin actividad", async () => {
    await seedFunnel();
    await setSetting("autoClose", { enabled: true, days: 7, reason: "Dejó de responder" });
    const old = await leadInactiveFor(8, "AI");
    const recent = await leadInactiveFor(3, "AI");
    const empty = await leadInactiveFor(10);

    expect(await runAutoClose(now)).toBe(2);
    expect(await status(old.id)).toMatchObject({ status: "LOST", lostReason: "Dejó de responder", aiEnabled: false });
    expect((await status(empty.id)).status).toBe("LOST");
    expect((await status(recent.id)).status).toBe("OPEN");
    const event = await db.leadEvent.findFirstOrThrow({ where: { leadId: old.id, type: "LOST" } });
    expect(event).toMatchObject({ actor: "SYSTEM", reason: "Dejó de responder" });
  });

  it("no cierra un lead cuyo último mensaje es del cliente sin respuesta", async () => {
    await seedFunnel();
    await setSetting("autoClose", { enabled: true, days: 7 });
    const lead = await leadInactiveFor(20, "CONTACT");
    expect(await runAutoClose(now)).toBe(0);
    expect((await status(lead.id)).status).toBe("OPEN");
  });

  it("un seguimiento de reactivación reinicia el plazo", async () => {
    await seedFunnel();
    await setSetting("autoClose", { enabled: true, days: 7 });
    const lead = await leadInactiveFor(20, "CONTACT");
    await db.message.create({ data: { leadId: lead.id, author: "AI", body: "¿Sigues interesado?", createdAt: ago(2) } });
    expect(await runAutoClose(now)).toBe(0);
    expect(await runAutoClose(new Date(now.getTime() + 6 * DAY))).toBe(1);
  });

  it("espera a que la reactivación agote sus intentos si su plazo es mayor", async () => {
    await seedFunnel();
    await setSetting("autoClose", { enabled: true, days: 7 });
    await setSetting("followUps", { enabled: true, delays: [60, 24 * 60, 7 * 24 * 60] });
    const lead = await leadInactiveFor(7.5, "AI");
    expect(await runAutoClose(now)).toBe(0);
    expect(await runAutoClose(new Date(now.getTime() + DAY))).toBe(1);
    expect((await status(lead.id)).status).toBe("LOST");
  });

  it("los movimientos recientes cuentan como actividad", async () => {
    const [, calificado] = await seedFunnel();
    await setSetting("autoClose", { enabled: true, days: 7 });
    const lead = await leadInactiveFor(20, "AI");
    await moveStage(lead.id, calificado.id, { actor: "USER" });
    expect(await runAutoClose(now)).toBe(0);
  });

  it("cierra los leads en una etapa de cierre con el motivo del movimiento", async () => {
    const [nuevo, , cotizacion] = await seedFunnel();
    await setSetting("autoClose", { enabled: true, days: 30, reason: "Inactivo", lostStageIds: [cotizacion.id] });
    const a = await createLead({ name: "A", channel: "SIMULATOR" });
    await moveStage(a.id, cotizacion.id, { actor: "USER" }, "Compró con otra empresa");
    const b = await createLead({ name: "B", channel: "SIMULATOR" });
    await moveStage(b.id, cotizacion.id, { actor: "USER" });
    const c = await createLead({ name: "C", channel: "SIMULATOR" });

    expect(await runAutoClose(now)).toBe(2);
    expect((await status(a.id)).lostReason).toBe("Compró con otra empresa");
    expect((await status(b.id)).lostReason).toBe("Inactivo");
    expect(await status(c.id)).toMatchObject({ status: "OPEN", stageId: nuevo.id });
  });

  it("no toca leads ya cerrados y deja registro de la pasada", async () => {
    await seedFunnel();
    await setSetting("autoClose", { enabled: true, days: 7 });
    const lead = await leadInactiveFor(20, "AI");
    await db.lead.update({ where: { id: lead.id }, data: { status: "WON" } });
    expect(await runAutoClose(now)).toBe(0);
    const run = await db.setting.findUniqueOrThrow({ where: { key: "autoCloseRun" } });
    expect(run.value).toEqual({ at: now.toISOString(), closed: 0 });
  });
});
