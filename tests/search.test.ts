import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { closeLead, createLead } from "@/lib/domain/leads";
import { searchLeads } from "@/lib/domain/search";
import { executive, seedFunnel } from "./factories";

describe("búsqueda global", () => {
  it("encuentra por nombre, correo o teléfono, con los abiertos primero", async () => {
    await seedFunnel();
    const ana = await createLead({ name: "Ana Pérez", channel: "WHATSAPP", phone: "+56911112222", externalId: "56911112222" });
    const old = await createLead({ name: "Ana Soto", channel: "INSTAGRAM" });
    await closeLead(old.id, "LOST", { actor: "SYSTEM" }, { lostReason: "no responde" });
    const otra = await createLead({ name: "Otra Ana", channel: "INSTAGRAM" });
    await db.contact.update({ where: { id: (await db.lead.findUniqueOrThrow({ where: { id: otra.id } })).contactId }, data: { email: "beto@example.com" } });

    const byName = await searchLeads("ana");
    expect(byName.map((h) => h.id)).toEqual([otra.id, ana.id, old.id]);
    expect(byName[1]).toMatchObject({ name: "Ana Pérez", detail: "+56911112222", status: "OPEN" });

    expect((await searchLeads("+56 9 1111")).map((h) => h.id)).toEqual([ana.id]);
    expect((await searchLeads("BETO@")).map((h) => h.id)).toEqual([otra.id]);
    expect(await searchLeads("a")).toEqual([]);
  });

  it("un ejecutivo solo ve sus leads", async () => {
    await seedFunnel();
    const carla = await executive("Carla");
    const mine = await createLead({ name: "Pedro Mío", channel: "INSTAGRAM" });
    await createLead({ name: "Pedro Ajeno", channel: "INSTAGRAM" });
    await db.lead.update({ where: { id: mine.id }, data: { assigneeId: carla.id } });
    expect((await searchLeads("pedro", { assigneeId: carla.id })).map((h) => h.id)).toEqual([mine.id]);
  });
});
