import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { closeLead, createLead, DomainError, reopenLead } from "@/lib/domain/leads";
import { seedFunnel } from "./factories";

describe("ganado / perdido", () => {
  it("cerrar como perdido exige motivo", async () => {
    await seedFunnel();
    const lead = await createLead({ name: "Cliente", channel: "SIMULATOR" });
    await expect(closeLead(lead.id, "LOST", { actor: "USER" }, { lostReason: " " })).rejects.toThrow(DomainError);
  });

  it("ganar guarda el monto, pausa la IA y se puede reabrir", async () => {
    await seedFunnel();
    const lead = await createLead({ name: "Cliente", channel: "SIMULATOR" });
    await closeLead(lead.id, "WON", { actor: "USER" }, { amount: 1_500_000 });
    let updated = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(updated).toMatchObject({ status: "WON", amount: 1_500_000, aiEnabled: false });

    await reopenLead(lead.id, { actor: "USER" });
    updated = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(updated).toMatchObject({ status: "OPEN", amount: null, closedAt: null });
  });
});
