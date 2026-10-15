import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createLeadByHand } from "@/lib/domain/contact-import";
import { executive, seedFunnel } from "./factories";

const by = { actor: "USER" as const };

describe("nuevo lead a mano", () => {
  it("crea contacto de WhatsApp con teléfono y correo, en la primera etapa", async () => {
    const [nuevo] = await seedFunnel();
    const { leadId, existing } = await createLeadByHand({ name: "Rosa Díaz", phone: "+56 9 8765 4321", email: "Rosa@Mail.cl" }, by);
    expect(existing).toBe(false);
    const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId }, include: { contact: true, events: true } });
    expect(lead.stageId).toBe(nuevo.id);
    expect(lead.contact).toMatchObject({ name: "Rosa Díaz", phone: "+56987654321", externalId: "56987654321", email: "rosa@mail.cl", channel: "WHATSAPP" });
    expect(lead.events[0]).toMatchObject({ type: "CREATED", actor: "USER", reason: "Creado a mano" });
  });

  it("no duplica: si el contacto ya tiene un lead abierto, devuelve ese", async () => {
    await seedFunnel();
    const first = await createLeadByHand({ name: "Rosa", phone: "+56987654321", email: "" }, by);
    const again = await createLeadByHand({ name: "Rosa D.", phone: "0056 9 8765 4321", email: "" }, by);
    expect(again).toEqual({ leadId: first.leadId, existing: true });
    expect(await db.contact.count()).toBe(1);
  });

  it("asigna al ejecutivo elegido y valida los datos", async () => {
    await seedFunnel();
    const carla = await executive("Carla");
    const { leadId } = await createLeadByHand({ name: "Luis", phone: "", email: "luis@mail.cl", assigneeId: carla.id }, by);
    expect((await db.lead.findUniqueOrThrow({ where: { id: leadId } })).assigneeId).toBe(carla.id);

    await expect(createLeadByHand({ name: "X", phone: "", email: "" }, by)).rejects.toThrow("teléfono o un correo");
    await expect(createLeadByHand({ name: "X", phone: "9 1234 5678", email: "" }, by)).rejects.toThrow("código de país");
    await expect(createLeadByHand({ name: "", phone: "+56912345678", email: "" }, by)).rejects.toThrow("nombre");
  });
});
