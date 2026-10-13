import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveCredentials } from "@/lib/credentials";
import { db } from "@/lib/db";
import { ChannelSendError } from "@/lib/channels/whatsapp";
import { downloadFromMeta, type MessengerApi, type MessengerWebhook, type MsgEvent, type MetaPlatform } from "@/lib/channels/messenger";
import { aiChannels, deliverOutbound, receiveMessenger, saveChannelSettings } from "@/lib/domain/channels";
import type { MediaStore } from "@/lib/media";
import { seedFunnel } from "./factories";

const PAGE_ID = "page-1";
const IG_ID = "ig-1";

function webhook(platform: MetaPlatform, events: MsgEvent[], entryId?: string): MessengerWebhook {
  return {
    object: platform === "INSTAGRAM" ? "instagram" : "page",
    entry: [{ id: entryId ?? (platform === "INSTAGRAM" ? IG_ID : PAGE_ID), messaging: events }],
  };
}

const msg = (mid: string, text: string, from = "user-1"): MsgEvent => ({
  sender: { id: from },
  recipient: { id: PAGE_ID },
  timestamp: Date.now(),
  message: { mid, text },
});

function fakeMessenger(fail?: ChannelSendError) {
  const sent: { platform: MetaPlatform; to: string; text?: string; audio?: string; file?: { kind: string; url: string } }[] = [];
  let n = 0;
  const lookups: string[] = [];
  const api: MessengerApi = {
    sendText: async (platform, to, text) => {
      if (fail) throw fail;
      sent.push({ platform, to, text });
      return `m_out${++n}`;
    },
    sendAudio: async (platform, to, audio) => {
      sent.push({ platform, to, audio });
      return `m_out${++n}`;
    },
    sendFile: async (platform, to, file) => {
      sent.push({ platform, to, file });
      return `m_out${++n}`;
    },
    profileName: async (platform, id) => {
      lookups.push(id);
      return platform === "INSTAGRAM" ? "@camila.r" : "Camila Rojas";
    },
    download: async () => ({ bytes: new Uint8Array([1, 2]), mimeType: "audio/mp4" }),
  };
  return { api, sent, lookups };
}

beforeEach(async () => {
  await saveCredentials({ META_PAGE_ID: PAGE_ID });
  await saveCredentials({ META_IG_ACCOUNT_ID: IG_ID });
});

describe("Instagram y Messenger: mensajes entrantes", () => {
  it("crea el contacto de Instagram con su nombre de perfil y no duplica reintentos", async () => {
    await seedFunnel();
    const { api, lookups } = fakeMessenger();
    const payload = webhook("INSTAGRAM", [msg("mid.1", "Hola, vi su publicación")]);
    await receiveMessenger(payload, { messenger: api });
    await receiveMessenger(payload, { messenger: api });
    await receiveMessenger(webhook("INSTAGRAM", [msg("mid.2", "¿Precio?")]), { messenger: api });

    const contact = await db.contact.findFirstOrThrow({ include: { leads: { include: { messages: true } } } });
    expect([contact.name, contact.channel, contact.externalId]).toEqual(["@camila.r", "INSTAGRAM", "user-1"]);
    expect(contact.leads).toHaveLength(1);
    expect(contact.leads[0].messages.map((m) => m.body).sort()).toEqual(["Hola, vi su publicación", "¿Precio?"]);
    // El nombre se pide a Meta solo al crear el contacto.
    expect(lookups).toEqual(["user-1"]);
  });

  it("Messenger: la IA responde solo si su canal está encendido", async () => {
    await seedFunnel();
    const { api } = fakeMessenger();
    expect(await receiveMessenger(webhook("FACEBOOK", [msg("mid.1", "Hola")]), { messenger: api })).toEqual([]);
    expect((await db.lead.findFirstOrThrow()).aiEnabled).toBe(false);

    await saveChannelSettings({ facebookAi: true });
    expect(await aiChannels()).toEqual(["SIMULATOR", "FACEBOOK"]);
    const toAnswer = await receiveMessenger(webhook("FACEBOOK", [msg("mid.2", "Hola", "user-2")]), { messenger: api });
    const lead = await db.lead.findFirstOrThrow({ where: { contact: { externalId: "user-2" } } });
    expect(toAnswer).toEqual([lead.id]);
    expect((await db.contact.findFirstOrThrow({ where: { externalId: "user-2" } })).name).toBe("Camila Rojas");
  });

  it("ignora ecos de nuestros envíos, mensajes borrados y cuentas ajenas; describe adjuntos y botones", async () => {
    await seedFunnel();
    const { api } = fakeMessenger();
    await receiveMessenger(
      webhook("INSTAGRAM", [
        { sender: { id: IG_ID }, recipient: { id: "user-1" }, message: { mid: "mid.e", text: "eco", is_echo: true } },
        { sender: { id: "user-1" }, recipient: { id: IG_ID }, message: { mid: "mid.d", is_deleted: true } },
      ]),
      { messenger: api },
    );
    await receiveMessenger(webhook("INSTAGRAM", [msg("mid.o", "otra cuenta")], "ig-otra"), { messenger: api });
    expect(await db.message.count()).toBe(0);

    await receiveMessenger(
      webhook("INSTAGRAM", [
        { sender: { id: "user-1" }, recipient: { id: IG_ID }, message: { mid: "mid.s", attachments: [{ type: "share" }] } },
        { sender: { id: "user-1" }, recipient: { id: IG_ID }, postback: { mid: "mid.p", title: "Quiero cotizar" } },
      ]),
      { messenger: api },
    );
    const bodies = (await db.message.findMany({ orderBy: { createdAt: "asc" } })).map((m) => m.body);
    expect(bodies).toEqual(["[Publicación compartida]", "Quiero cotizar"]);
  });

  it("descarga y transcribe las notas de voz", async () => {
    await seedFunnel();
    const { api } = fakeMessenger();
    const store: MediaStore = async (file, folder) => `https://blob.test/${folder}/${file.fileName}`;
    await receiveMessenger(
      webhook("FACEBOOK", [
        {
          sender: { id: "user-1" },
          recipient: { id: PAGE_ID },
          message: { mid: "mid.a", attachments: [{ type: "audio", payload: { url: "https://cdn.meta/a.mp4" } }] },
        },
      ]),
      { messenger: api, media: { store, transcribe: async () => "¿Tienen financiamiento?" } },
    );
    const m = await db.message.findFirstOrThrow();
    expect([m.externalId, m.transcript, m.mediaType]).toEqual(["mid.a", "¿Tienen financiamiento?", "audio/mp4"]);
  });
});

describe("Instagram y Messenger: envío", () => {
  async function igLead() {
    await seedFunnel();
    await receiveMessenger(webhook("INSTAGRAM", [msg("mid.1", "Hola")]), { messenger: fakeMessenger().api });
    return db.lead.findFirstOrThrow();
  }

  it("envía los pendientes por la plataforma del contacto y los marca leídos con el aviso de lectura", async () => {
    const lead = await igLead();
    await db.message.create({ data: { leadId: lead.id, author: "AI", body: "¡Hola! ¿En qué te ayudo?" } });
    const { api, sent } = fakeMessenger();
    expect(await deliverOutbound(lead.id, { messenger: api })).toBeNull();
    expect(sent).toEqual([{ platform: "INSTAGRAM", to: "user-1", text: "¡Hola! ¿En qué te ayudo?" }]);

    await receiveMessenger(
      webhook("INSTAGRAM", [{ sender: { id: "user-1" }, recipient: { id: IG_ID }, timestamp: Date.now() + 1000, read: { mid: "m_out1" } }]),
      { messenger: api },
    );
    const ai = await db.message.findFirstOrThrow({ where: { author: "AI" } });
    expect([ai.deliveryStatus, ai.externalId]).toEqual(["READ", "m_out1"]);
  });

  it("guarda el motivo si Meta rechaza el envío", async () => {
    const lead = await igLead();
    await db.message.create({ data: { leadId: lead.id, author: "AI", body: "¿Sigues ahí?" } });
    const reason = "Pasaron más de 24 horas desde el último mensaje del cliente.";
    const { api } = fakeMessenger(new ChannelSendError(reason, 10));
    expect(await deliverOutbound(lead.id, { messenger: api })).toBe(reason);
    expect((await db.message.findFirstOrThrow({ where: { author: "AI" } })).deliveryStatus).toBe("FAILED");
  });
});

describe("Instagram y Messenger: descarga de adjuntos", () => {
  const fetcher = (bytes: number, headers: Record<string, string> = {}) =>
    (async () => new Response(new Uint8Array(bytes), { headers: { "content-type": "audio/mp4", ...headers } })) as typeof fetch;

  it("solo descarga por https desde Meta", async () => {
    const ok = await downloadFromMeta("https://scontent.xx.fbcdn.net/a.mp4", 10, fetcher(3));
    expect([ok.bytes.byteLength, ok.mimeType]).toEqual([3, "audio/mp4"]);
    await downloadFromMeta("https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1", 10, fetcher(3));
    for (const url of ["http://scontent.xx.fbcdn.net/a.mp4", "https://169.254.169.254/latest", "https://fbcdn.net.evil.com/a"]) {
      await expect(downloadFromMeta(url, 10, fetcher(3))).rejects.toThrow(/fuera de Meta/);
    }
  });

  it("corta al pasar el tamaño máximo, aunque Meta no informe el largo", async () => {
    await expect(downloadFromMeta("https://cdninstagram.com/a", 10, fetcher(11, { "content-length": "11" }))).rejects.toThrow(/pesa más/);
    const noLength = (async () => new Response(new ReadableStream({ pull: (c) => c.enqueue(new Uint8Array(4)) }))) as typeof fetch;
    await expect(downloadFromMeta("https://cdninstagram.com/a", 10, noLength)).rejects.toThrow(/pesa más/);
  });
});
