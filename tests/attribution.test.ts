import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { AdsApi } from "@/lib/channels/ads";
import type { MessengerApi, MsgEvent } from "@/lib/channels/messenger";
import type { WaMessage, WaWebhook } from "@/lib/channels/whatsapp";
import {
  campaignOf,
  createSourceLink,
  extractRefCode,
  saveAttributionSettings,
  getAttributionSettings,
  whatsappUrl,
} from "@/lib/domain/attribution";
import { receiveMessenger, receiveWhatsApp } from "@/lib/domain/channels";
import { closeLead } from "@/lib/domain/leads";
import { seedFunnel } from "./factories";

const PHONE_ID = "1234567890";

const wa = (messages: WaMessage[]): WaWebhook => ({
  object: "whatsapp_business_account",
  entry: [
    {
      changes: [
        {
          field: "messages",
          value: {
            metadata: { phone_number_id: PHONE_ID },
            contacts: messages.map((m) => ({ wa_id: m.from, profile: { name: "Ana Pérez" } })),
            messages,
          },
        },
      ],
    },
  ],
});

const text = (id: string, body: string, extra: Partial<WaMessage> = {}): WaMessage => ({
  from: "56911112222",
  id,
  type: "text",
  text: { body },
  ...extra,
});

function fakeAds() {
  const lookups: string[] = [];
  const ads: AdsApi = {
    lookup: async (adId) => {
      lookups.push(adId);
      return { adName: "Video dron", adsetName: "Santiago 30-55", campaignId: "c-1", campaignName: "Parcelas Sur" };
    },
  };
  return { ads, lookups };
}

const messenger: MessengerApi = {
  sendText: async () => "m",
  sendAudio: async () => "m",
  profileName: async () => "Camila",
  download: async () => ({ bytes: new Uint8Array(), mimeType: "audio/mp4" }),
};

beforeEach(() => {
  process.env.WHATSAPP_PHONE_NUMBER_ID = PHONE_ID;
  process.env.META_PAGE_ID = "page-1";
});
afterEach(() => {
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  delete process.env.META_PAGE_ID;
});

describe("Origen: anuncios de Meta", () => {
  it("guarda el anuncio de clic a WhatsApp con su campaña y no lo reemplaza después", async () => {
    await seedFunnel();
    const { ads, lookups } = fakeAds();
    const referral = {
      source_url: "https://fb.me/abc",
      source_id: "120200",
      source_type: "ad",
      headline: "Parcelas desde 39 millones",
      body: "Escríbenos",
      ctwa_clid: "ARAkLkA8",
    };
    await receiveWhatsApp(wa([text("wamid.1", "Hola", { referral })]), { ads });
    await receiveWhatsApp(wa([text("wamid.2", "Otra vez", { referral: { ...referral, source_id: "999" } })]), { ads });

    const source = await db.leadSource.findFirstOrThrow();
    expect(source).toMatchObject({
      kind: "AD",
      adId: "120200",
      adHeadline: "Parcelas desde 39 millones",
      adUrl: "https://fb.me/abc",
      ctwaClid: "ARAkLkA8",
      campaignName: "Parcelas Sur",
      adsetName: "Santiago 30-55",
    });
    expect(lookups).toEqual(["120200"]);
    expect(campaignOf(source)).toBe("Parcelas Sur");
    expect(await db.message.count()).toBe(2);
  });

  it("si la API de Marketing no responde, igual guarda lo que mandó Meta", async () => {
    await seedFunnel();
    const ads: AdsApi = { lookup: async () => null };
    await receiveWhatsApp(wa([text("wamid.1", "Hola", { referral: { source_id: "77", source_type: "ad", headline: "Oferta" } })]), { ads });
    const source = await db.leadSource.findFirstOrThrow();
    expect([source.campaignName, campaignOf(source)]).toEqual([null, "Oferta"]);
  });

  it("un lead nuevo del mismo contacto toma el anuncio por el que volvió", async () => {
    await seedFunnel();
    const { ads } = fakeAds();
    await receiveWhatsApp(wa([text("wamid.1", "Hola")]), { ads });
    const first = await db.lead.findFirstOrThrow();
    expect(await db.leadSource.count()).toBe(0);
    await closeLead(first.id, "LOST", { actor: "USER" }, { lostReason: "No contesta" });

    await receiveWhatsApp(wa([text("wamid.2", "Hola de nuevo", { referral: { source_id: "5", source_type: "ad" } })]), { ads });
    const source = await db.leadSource.findFirstOrThrow();
    expect(source.leadId).not.toBe(first.id);
  });

  it("Messenger e Instagram: anuncio en el mensaje o en un clic sobre una conversación que ya existía", async () => {
    await seedFunnel();
    const { ads } = fakeAds();
    const event = (e: Partial<MsgEvent>): MsgEvent => ({ sender: { id: "user-1" }, recipient: { id: "page-1" }, ...e });
    await receiveMessenger(
      { object: "page", entry: [{ id: "page-1", messaging: [event({ message: { mid: "m.1", text: "Hola" } })] }] },
      { messenger, ads },
    );
    expect(await db.leadSource.count()).toBe(0);
    await receiveMessenger(
      {
        object: "page",
        entry: [
          {
            id: "page-1",
            messaging: [event({ referral: { source: "ADS", type: "OPEN_THREAD", ad_id: "333", ads_context_data: { ad_title: "Parcelas" } } })],
          },
        ],
      },
      { messenger, ads },
    );
    expect(await db.leadSource.findFirstOrThrow()).toMatchObject({ kind: "AD", adId: "333", adHeadline: "Parcelas", campaignName: "Parcelas Sur" });
  });
});

describe("Origen: enlace /wa desde una landing", () => {
  it("el código del mensaje une los UTM al lead y se quita del texto", async () => {
    await seedFunnel();
    const code = await createSourceLink({ utmSource: "google", utmCampaign: "parcelas-sur", landingUrl: "https://landing.cl/sur" });
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    const url = whatsappUrl("+56 9 1234 5678", "Hola, quiero información", code);
    expect(url).toBe(`https://wa.me/56912345678?text=${encodeURIComponent(`Hola, quiero información\n\n(ref. ${code})`)}`);

    await receiveWhatsApp(wa([text("wamid.1", `Hola, quiero información\n\n(ref. ${code})`)]));
    const lead = await db.lead.findFirstOrThrow({ include: { source: true, messages: true } });
    expect(lead.messages[0].body).toBe("Hola, quiero información");
    expect(lead.source).toMatchObject({ kind: "LINK", utmSource: "google", utmCampaign: "parcelas-sur", landingUrl: "https://landing.cl/sur" });
    expect((await db.sourceLink.findUniqueOrThrow({ where: { code: code! } })).leadId).toBe(lead.id);
  });

  it("sin UTM no crea código y un código que no existe no se toca", async () => {
    await seedFunnel();
    expect(await createSourceLink({ landingUrl: "https://landing.cl" })).toBeNull();
    await receiveWhatsApp(wa([text("wamid.1", "Hola (ref. ABCDEF)")]));
    const lead = await db.lead.findFirstOrThrow({ include: { source: true, messages: true } });
    expect(lead.source).toBeNull();
    expect(lead.messages[0].body).toBe("Hola (ref. ABCDEF)");
  });

  it("reconoce el código aunque el cliente lo reescriba", () => {
    expect(extractRefCode("hola ref: k7q2mx gracias")).toEqual({ code: "K7Q2MX", text: "hola gracias" });
    expect(extractRefCode("Me interesa la referencia del lote")).toBeNull();
  });

  it("guarda el número solo con dígitos", async () => {
    await saveAttributionSettings({ whatsappNumber: "+56 9 1234-5678" });
    expect((await getAttributionSettings()).whatsappNumber).toBe("56912345678");
  });
});
