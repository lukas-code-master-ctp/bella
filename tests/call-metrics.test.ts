import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { formatCallDuration, getCallReport } from "@/lib/domain/call-metrics";
import { createLead } from "@/lib/domain/leads";
import { executive, seedFunnel } from "./factories";

const FROM = new Date("2026-10-01T03:00:00Z");
const TO = new Date("2026-10-28T23:00:00Z");
let n = 0;

function call(leadId: string, data: { direction?: string; status: string; answeredById?: string; durationSec?: number; at: string; recordingUrl?: string }) {
  return db.call.create({
    data: {
      leadId,
      externalId: `wacid.${++n}`,
      phoneNumberId: "123",
      direction: data.direction ?? "INBOUND",
      status: data.status,
      answeredById: data.answeredById,
      durationSec: data.durationSec,
      recordingUrl: data.recordingUrl,
      createdAt: new Date(data.at),
    },
  });
}

beforeEach(async () => {
  await seedFunnel();
});

describe("Métricas de llamadas", () => {
  it("cuenta recibidas, perdidas y hechas, por ejecutivo, y marca las perdidas devueltas", async () => {
    const luis = await executive("Luis");
    const ana = await executive("Ana");
    const a = await createLead({ name: "Cliente A", channel: "WHATSAPP", externalId: "569111" });
    const b = await createLead({ name: "Cliente B", channel: "WHATSAPP", externalId: "569222" });
    await db.lead.update({ where: { id: b.id }, data: { assigneeId: ana.id } });
    const sim = await createLead({ name: "Simulador", channel: "SIMULATOR" });

    await call(a.id, { status: "ENDED", answeredById: luis.id, durationSec: 60, at: "2026-10-20T15:00:00Z", recordingUrl: "https://x/a.webm" });
    await call(a.id, { status: "MISSED", at: "2026-10-21T15:00:00Z" });
    // Luis le devolvió la llamada y el cliente contestó.
    await call(a.id, { direction: "OUTBOUND", status: "ENDED", answeredById: luis.id, durationSec: 120, at: "2026-10-21T16:00:00Z" });
    await call(b.id, { status: "REJECTED", at: "2026-10-22T15:00:00Z" });
    await call(b.id, { direction: "OUTBOUND", status: "MISSED", answeredById: ana.id, at: "2026-10-22T16:00:00Z" });
    await call(b.id, { status: "RINGING", at: "2026-10-28T22:59:00Z" });
    // Fuera del período o del simulador: no cuentan.
    await call(a.id, { status: "MISSED", at: "2026-09-10T15:00:00Z" });
    await call(sim.id, { status: "MISSED", at: "2026-10-22T15:00:00Z" });

    const r = await getCallReport({ from: FROM, to: TO });
    expect(r).toMatchObject({
      inbound: 4,
      inboundAnswered: 1,
      inboundMissed: 2,
      outbound: 2,
      outboundConnected: 1,
      outboundUnanswered: 1,
      avgSec: 90,
      totalSec: 180,
      recorded: 1,
    });
    expect(r.byUser).toEqual([
      { userId: luis.id, name: "Luis", answered: 1, made: 1, connected: 1, totalSec: 180 },
      { userId: ana.id, name: "Ana", answered: 0, made: 1, connected: 0, totalSec: 0 },
    ]);
    expect(r.recentMissed.map((m) => [m.name, m.calledBack])).toEqual([
      ["Cliente B", false],
      ["Cliente A", true],
    ]);

    // Ana ve las llamadas que hizo y las de sus leads.
    const mine = await getCallReport({ from: FROM, to: TO, userId: ana.id });
    expect(mine).toMatchObject({ inbound: 2, inboundMissed: 1, outbound: 1, outboundUnanswered: 1 });
    expect(mine.byUser.map((u) => u.name)).toEqual(["Ana"]);
  });

  it("formatea duraciones cortas y largas", () => {
    expect(formatCallDuration(67)).toBe("1:07");
    expect(formatCallDuration(3900)).toBe("1 h 05 min");
    expect(formatCallDuration(null)).toBe("—");
  });
});
