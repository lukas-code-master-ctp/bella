import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createLead } from "@/lib/domain/leads";
import { chatTemplates, replyWindowClosed, sendLeadTemplate } from "@/lib/domain/reply-window";
import { ChannelSendError, type ApprovedTemplate, type TemplateMessage, type WhatsAppApi } from "@/lib/channels/whatsapp";
import { seedFunnel } from "./factories";

const HOUR = 60 * 60 * 1000;

const template = (extra: Partial<ApprovedTemplate> = {}): ApprovedTemplate => ({
  name: "retomar",
  language: "es",
  status: "APPROVED",
  category: "MARKETING",
  body: "Hola {{1}}, ¿seguimos con {{2}}?",
  params: 2,
  header: null,
  urlButtons: [],
  unsupported: null,
  ...extra,
});
const templates = async () => [template(), template({ name: "con_foto", header: "image" })];

async function whatsAppLead(lastContactHoursAgo: number | null) {
  await seedFunnel();
  const lead = await createLead({ name: "Ana Pérez", channel: "WHATSAPP", phone: "+56911112222", externalId: "56911112222" });
  if (lastContactHoursAgo !== null) {
    await db.message.create({ data: { leadId: lead.id, author: "CONTACT", body: "Hola", createdAt: new Date(Date.now() - lastContactHoursAgo * HOUR) } });
  }
  return lead;
}

describe("ventana de 24 h en el chat", () => {
  it("se cierra pasadas 24 h del último mensaje del cliente (o si nunca escribió), salvo en el simulador", async () => {
    const lead = await whatsAppLead(2);
    expect(await replyWindowClosed(lead.id)).toBe(false);
    await db.message.updateMany({ where: { leadId: lead.id }, data: { createdAt: new Date(Date.now() - 25 * HOUR) } });
    expect(await replyWindowClosed(lead.id)).toBe(true);
    const never = await createLead({ name: "Beto", channel: "INSTAGRAM", externalId: "ig1" });
    expect(await replyWindowClosed(never.id)).toBe(true);
    const sim = await createLead({ name: "Caro", channel: "SIMULATOR" });
    expect(await replyWindowClosed(sim.id)).toBe(false);
  });

  it("solo ofrece las plantillas de texto; las que llevan archivo quedan para Envíos masivos", async () => {
    const list = await chatTemplates(templates);
    expect(list.map((t) => [t.name, Boolean(t.unsupported)])).toEqual([
      ["retomar", false],
      ["con_foto", true],
    ]);
  });

  it("un ejecutivo manda la plantilla con sus variables y queda en el chat", async () => {
    const lead = await whatsAppLead(30);
    const user = await db.user.create({ data: { name: "Eva", email: "eva@test.cl", passwordHash: "x", role: "EXECUTIVE" } });
    const sent: { to: string; t: TemplateMessage }[] = [];
    const api = { sendTemplate: async (to: string, t: TemplateMessage) => (sent.push({ to, t }), "wamid.1") } as unknown as WhatsAppApi;

    expect(await sendLeadTemplate(lead.id, user.id, { name: "retomar", language: "es", params: ["Ana", " la parcela "] }, { api, templates })).toBeNull();
    expect(sent).toEqual([{ to: "56911112222", t: { name: "retomar", language: "es", params: ["Ana", "la parcela"] } }]);
    expect(await db.message.findFirst({ where: { leadId: lead.id, author: "USER" } })).toMatchObject({
      userId: user.id,
      body: "Hola Ana, ¿seguimos con la parcela?",
      deliveryStatus: "SENT",
      externalId: "wamid.1",
    });

    await expect(sendLeadTemplate(lead.id, user.id, { name: "retomar", language: "es", params: ["Ana"] }, { api, templates })).rejects.toThrow("variables");
    await expect(sendLeadTemplate(lead.id, user.id, { name: "con_foto", language: "es", params: [] }, { api, templates })).rejects.toThrow("Envíos masivos");
    await expect(sendLeadTemplate(lead.id, user.id, { name: "otra", language: "es", params: [] }, { api, templates })).rejects.toThrow("aprobada");
  });

  it("si WhatsApp la rechaza, el mensaje queda fallido con el motivo", async () => {
    const lead = await whatsAppLead(30);
    const user = await db.user.create({ data: { name: "Eva", email: "eva@test.cl", passwordHash: "x", role: "EXECUTIVE" } });
    const api = {
      sendTemplate: async () => {
        throw new ChannelSendError("Plantilla pausada por Meta.");
      },
    } as unknown as WhatsAppApi;
    expect(await sendLeadTemplate(lead.id, user.id, { name: "retomar", language: "es", params: ["Ana", "x"] }, { api, templates })).toBe("Plantilla pausada por Meta.");
    expect(await db.message.findFirst({ where: { leadId: lead.id, author: "USER" } })).toMatchObject({
      deliveryStatus: "FAILED",
      deliveryError: "Plantilla pausada por Meta.",
    });
  });
});
