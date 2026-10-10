import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ChannelSendError, type WaWebhook, type WhatsAppApi } from "@/lib/channels/whatsapp";
import { deliverOutbound, getWhatsAppWebhookLog, logWhatsAppWebhook, receiveWhatsApp } from "@/lib/domain/channels";
import { createFunnel } from "@/lib/domain/funnels";
import { addWhatsAppNumber, deleteWhatsAppNumber, updateWhatsAppNumber } from "@/lib/domain/whatsapp-numbers";
import { seedFunnel } from "./factories";

const MAIN = "1111111111";
const OTHER = "2222222222";

const wa = (phoneId: string, id: string, from = "56911112222"): WaWebhook => ({
  object: "whatsapp_business_account",
  entry: [
    {
      changes: [
        {
          field: "messages",
          value: {
            metadata: { phone_number_id: phoneId },
            contacts: [{ wa_id: from, profile: { name: "Ana" } }],
            messages: [{ from, id, type: "text", text: { body: "hola" } }],
          },
        },
      ],
    },
  ],
});

const lookup = async () => ({ displayPhone: "+56 9 2222 2222", name: "Ventas online" });

function fakeWa() {
  const sent: { to: string; from?: string }[] = [];
  const api: WhatsAppApi = {
    sendText: async (to, _body, from) => {
      sent.push({ to, from });
      return `wamid.out${sent.length}`;
    },
    sendAudio: async () => "wamid.audio",
    sendFile: async () => "wamid.file",
    downloadMedia: async () => ({ bytes: new Uint8Array(), mimeType: "audio/ogg" }),
  };
  return { api, sent };
}

async function onlineFunnel() {
  const f = await createFunnel("Venta online");
  const stage = await db.stage.create({ data: { funnelId: f.id, name: "Nuevo online", position: 0 } });
  return { funnel: f, stage };
}

let principal: Awaited<ReturnType<typeof seedFunnel>>;

beforeEach(async () => {
  process.env.WHATSAPP_PHONE_NUMBER_ID = MAIN;
  principal = await seedFunnel();
});
afterEach(() => {
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
});

describe("varios números de WhatsApp", () => {
  it("sin agregarlo, los mensajes de otro número se ignoran", async () => {
    await receiveWhatsApp(wa(OTHER, "wamid.1"));
    expect(await db.lead.count()).toBe(0);
    await logWhatsAppWebhook(wa(OTHER, "wamid.1"));
    expect((await getWhatsAppWebhookLog())?.result).toBe("otro-numero");
  });

  it("un número agregado recibe mensajes, lleva sus leads a su embudo y responde por él", async () => {
    const { funnel, stage } = await onlineFunnel();
    await addWhatsAppNumber({ phoneNumberId: OTHER, label: "", funnelId: funnel.id }, lookup);
    await receiveWhatsApp(wa(OTHER, "wamid.1"));
    const lead = await db.lead.findFirstOrThrow({ include: { contact: true } });
    expect(lead.stageId).toBe(stage.id);
    expect(lead.contact.waPhoneNumberId).toBe(OTHER);
    expect((await db.whatsAppNumber.findFirstOrThrow()).label).toBe("Ventas online");

    await db.message.create({ data: { leadId: lead.id, author: "USER", body: "hola" } });
    const { api, sent } = fakeWa();
    await deliverOutbound(lead.id, { whatsapp: api });
    expect(sent).toEqual([{ to: "56911112222", from: OTHER }]);
  });

  it("el número principal sigue entrando al embudo del canal", async () => {
    await onlineFunnel();
    await receiveWhatsApp(wa(MAIN, "wamid.1"));
    expect((await db.lead.findFirstOrThrow()).stageId).toBe(principal[0].id);
  });

  it("un número sin embudo usa el del canal, y al quitarlo sus clientes vuelven al principal", async () => {
    const n = await addWhatsAppNumber({ phoneNumberId: OTHER, label: "Postventa" }, lookup);
    await receiveWhatsApp(wa(OTHER, "wamid.1"));
    expect((await db.lead.findFirstOrThrow()).stageId).toBe(principal[0].id);
    const { funnel } = await onlineFunnel();
    await updateWhatsAppNumber(n.id, { label: "Postventa", funnelId: funnel.id });
    expect((await db.whatsAppNumber.findUniqueOrThrow({ where: { id: n.id } })).funnelId).toBe(funnel.id);
    await deleteWhatsAppNumber(n.id);
    expect((await db.contact.findFirstOrThrow()).waPhoneNumberId).toBeNull();
  });

  it("valida el id antes de guardarlo", async () => {
    await expect(addWhatsAppNumber({ phoneNumberId: "+56 9 2222", label: "x" }, lookup)).rejects.toThrow(/solo dígitos/);
    await expect(addWhatsAppNumber({ phoneNumberId: MAIN, label: "x" }, lookup)).rejects.toThrow(/principal/);
    const denied = async () => {
      throw new ChannelSendError("WhatsApp rechazó la consulta del número: sin permiso");
    };
    await expect(addWhatsAppNumber({ phoneNumberId: OTHER, label: "x" }, denied)).rejects.toThrow(/sin permiso/);
    expect(await db.whatsAppNumber.count()).toBe(0);
  });
});
