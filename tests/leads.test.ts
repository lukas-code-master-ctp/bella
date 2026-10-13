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

  it("no reabre si el contacto ya tiene otro lead abierto; la base tampoco deja dos abiertos", async () => {
    await seedFunnel();
    const first = await createLead({ name: "Cliente", channel: "SIMULATOR" });
    await closeLead(first.id, "LOST", { actor: "USER" }, { lostReason: "Sin respuesta" });
    const second = await createLead({ contactId: first.contactId });
    await expect(reopenLead(first.id, { actor: "USER" })).rejects.toThrow(/otro lead abierto/);
    await expect(createLead({ contactId: second.contactId })).rejects.toMatchObject({ code: "P2002" });
  });
});
