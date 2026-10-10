import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { WaWebhook, WhatsAppApi } from "@/lib/channels/whatsapp";
import type { MessengerApi } from "@/lib/channels/messenger";
import { deliverOutbound, receiveMessenger, receiveWhatsApp, saveChannelSettings } from "@/lib/domain/channels";
import { BLOCKED_LOST_REASON, blockContact, unblockContact } from "@/lib/domain/contacts";
import { runAgent } from "@/lib/ai/agent";
import { reopenLead, setAiEnabled } from "@/lib/domain/leads";
import { seedFunnel } from "./factories";

const PHONE_ID = "1234567890";

const wa = (id: string, body: string, from = "56911112222"): WaWebhook => ({
  object: "whatsapp_business_account",
  entry: [
    {
      changes: [
        {
          field: "messages",
          value: {
            metadata: { phone_number_id: PHONE_ID },
            contacts: [{ wa_id: from, profile: { name: "Spam" } }],
            messages: [{ from, id, type: "text", text: { body } }],
          },
        },
      ],
    },
  ],
});

function fakeWa() {
  const sent: string[] = [];
  const api: WhatsAppApi = {
    sendText: async (_to, body) => {
      sent.push(body);
      return `wamid.out${sent.length}`;
    },
    sendAudio: async () => "wamid.audio",
    downloadMedia: async () => ({ bytes: new Uint8Array(), mimeType: "audio/ogg" }),
  };
  return { api, sent };
}

beforeEach(async () => {
  process.env.WHATSAPP_PHONE_NUMBER_ID = PHONE_ID;
  await seedFunnel();
  await saveChannelSettings({ whatsappAi: true, instagramAi: true });
});

describe("bloquear contactos", () => {
  it("cierra sus leads abiertos y descarta los mensajes nuevos sin crear leads", async () => {
    const [leadId] = await receiveWhatsApp(wa("wamid.1", "hola"));
    await blockContact(leadId, { actor: "USER" }, "spam");

    const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId }, include: { contact: true } });
    expect(lead).toMatchObject({ status: "LOST", lostReason: BLOCKED_LOST_REASON, aiEnabled: false });
    expect(lead.contact.blockedReason).toBe("spam");
    expect(lead.contact.blockedAt).not.toBeNull();

    const toAnswer = await receiveWhatsApp(wa("wamid.2", "hola de nuevo"));
    expect(toAnswer).toEqual([]);
    expect(await db.lead.count()).toBe(1);
    expect(await db.message.count({ where: { externalId: "wamid.2" } })).toBe(0);

    const events = await db.leadEvent.findMany({ where: { leadId }, select: { type: true } });
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["LOST", "BLOCKED"]));
  });

  it("también descarta los mensajes de Instagram", async () => {
    const api = { profileName: async () => "Usuario" } as unknown as MessengerApi;
    const payload = (mid: string) => ({
      object: "instagram" as const,
      entry: [{ id: "ig-1", messaging: [{ sender: { id: "ig-user" }, recipient: { id: "ig-1" }, timestamp: Date.now(), message: { mid, text: "hola" } }] }],
    });
    const [leadId] = await receiveMessenger(payload("m1"), { messenger: api });
    await blockContact(leadId, { actor: "USER" });
    expect(await receiveMessenger(payload("m2"), { messenger: api })).toEqual([]);
    expect(await db.message.count({ where: { externalId: "m2" } })).toBe(0);
  });

  it("no envía mensajes del equipo ni responde la IA aunque se reabra el lead", async () => {
    const [leadId] = await receiveWhatsApp(wa("wamid.1", "hola"));
    await blockContact(leadId, { actor: "USER" });
    await reopenLead(leadId, { actor: "USER" });
    await setAiEnabled(leadId, true, { actor: "USER" });
    expect(await runAgent(leadId)).toBe("skipped");

    await db.message.create({ data: { leadId, author: "USER", body: "hola" } });
    const { api, sent } = fakeWa();
    expect(await deliverOutbound(leadId, { whatsapp: api })).toMatch(/bloqueado/);
    expect(sent).toEqual([]);
    expect(await db.message.findFirst({ where: { leadId, author: "USER" } })).toMatchObject({ deliveryStatus: "FAILED" });
  });

  it("al desbloquear, los mensajes nuevos vuelven a entrar en un lead nuevo", async () => {
    const [leadId] = await receiveWhatsApp(wa("wamid.1", "hola"));
    await blockContact(leadId, { actor: "USER" });
    await unblockContact(leadId, { actor: "USER" });
    const [next] = await receiveWhatsApp(wa("wamid.2", "hola otra vez"));
    expect(next).toBeDefined();
    expect(next).not.toBe(leadId);
    const contact = await db.contact.findFirstOrThrow();
    expect(contact.blockedAt).toBeNull();
  });
});
