import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveCredentials } from "@/lib/credentials";
import { db } from "@/lib/db";
import { answerLead, answerLeadWhenQuiet } from "@/lib/ai/respond";
import type { AiConfig } from "@/lib/ai/config";
import type { ChatClient } from "@/lib/ai/providers";
import { runDueFollowUps } from "@/lib/ai/follow-ups";
import { ChannelSendError, checkWhatsApp, validSignature, type WaMessage, type WaWebhook, type WhatsAppApi } from "@/lib/channels/whatsapp";
import {
  aiChannels,
  deliverOutbound,
  getWhatsAppWebhookLog,
  logWhatsAppWebhook,
  receiveWhatsApp,
  saveChannelSettings,
} from "@/lib/domain/channels";
import { closeLead } from "@/lib/domain/leads";
import { setSetting } from "@/lib/settings";
import type { MediaStore } from "@/lib/media";
import { executive, seedFunnel } from "./factories";

const PHONE_ID = "1234567890";

function webhook(messages: WaMessage[], extra: Partial<{ statuses: object[]; phoneId: string; name: string }> = {}): WaWebhook {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: extra.phoneId ?? PHONE_ID },
              contacts: messages.map((m) => ({ wa_id: m.from, profile: { name: extra.name ?? "Ana Pérez" } })),
              messages,
              statuses: extra.statuses as never,
            },
          },
        ],
      },
    ],
  };
}

const text = (id: string, body: string, from = "56911112222"): WaMessage => ({ from, id, type: "text", text: { body } });

/** WhatsApp falso: registra los envíos y devuelve ids correlativos. */
function fakeApi(fail?: ChannelSendError) {
  const sent: { to: string; text?: string; audio?: string; file?: object }[] = [];
  let n = 0;
  const api: WhatsAppApi = {
    sendText: async (to, body) => {
      if (fail) throw fail;
      sent.push({ to, text: body });
      return `wamid.out${++n}`;
    },
    sendAudio: async (to, url) => {
      sent.push({ to, audio: url });
      return `wamid.out${++n}`;
    },
    sendFile: async (to, file) => {
      sent.push({ to, file });
      return `wamid.out${++n}`;
    },
    downloadMedia: async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: "audio/ogg; codecs=opus" }),
  };
  return { api, sent };
}

function fakeChat(reply: string) {
  let calls = 0;
  const client: ChatClient = {
    complete: async () => {
      calls++;
      return { choices: [{ finish_reason: "stop", message: { role: "assistant", content: reply } }] };
    },
  };
  return { client, calls: () => calls };
}

beforeEach(async () => {
  await saveCredentials({ WHATSAPP_PHONE_NUMBER_ID: PHONE_ID });
  await setSetting<AiConfig>("ai", { provider: "openrouter", model: "modelo-x", effort: "medium" });
});

describe("WhatsApp: mensajes entrantes", () => {
  it("crea el contacto y el lead con el nombre del perfil y guarda el mensaje una sola vez", async () => {
    await seedFunnel();
    const payload = webhook([text("wamid.1", "Hola, ¿tienen parcelas?")]);
    await receiveWhatsApp(payload);
    await receiveWhatsApp(payload); // Meta reintenta

    const contact = await db.contact.findFirstOrThrow({ include: { leads: { include: { messages: true } } } });
    expect([contact.name, contact.phone, contact.channel, contact.externalId]).toEqual([
      "Ana Pérez",
      "+56911112222",
      "WHATSAPP",
      "56911112222",
    ]);
    expect(contact.leads).toHaveLength(1);
    expect(contact.leads[0].messages.map((m) => [m.author, m.body, m.externalId])).toEqual([
      ["CONTACT", "Hola, ¿tienen parcelas?", "wamid.1"],
    ]);
  });

  it("con la IA de WhatsApp apagada (por defecto) el lead entra con la IA pausada y nadie responde", async () => {
    await seedFunnel();
    const toAnswer = await receiveWhatsApp(webhook([text("wamid.1", "Hola")]));
    expect(toAnswer).toEqual([]);
    expect((await db.lead.findFirstOrThrow()).aiEnabled).toBe(false);
    expect(await aiChannels()).toEqual(["SIMULATOR"]);
  });

  it("con la IA encendida devuelve el lead para que la asistente responda", async () => {
    await seedFunnel();
    await saveChannelSettings({ whatsappAi: true });
    const toAnswer = await receiveWhatsApp(webhook([text("wamid.1", "Hola"), text("wamid.2", "¿Precio?")]));
    const lead = await db.lead.findFirstOrThrow();
    expect(toAnswer).toEqual([lead.id]);
    expect(lead.aiEnabled).toBe(true);
  });

  it("si el último lead del contacto está cerrado, abre una nueva oportunidad para el mismo contacto", async () => {
    await seedFunnel();
    await receiveWhatsApp(webhook([text("wamid.1", "Hola")]));
    const first = await db.lead.findFirstOrThrow();
    await closeLead(first.id, "LOST", { actor: "SYSTEM" }, { lostReason: "Sin respuesta" });
    await receiveWhatsApp(webhook([text("wamid.2", "Volví, ¿siguen disponibles?")]));

    expect(await db.contact.count()).toBe(1);
    const leads = await db.lead.findMany({ orderBy: { createdAt: "asc" }, include: { messages: true } });
    expect(leads.map((l) => [l.status, l.messages.map((m) => m.body)])).toEqual([
      ["LOST", ["Hola"]],
      ["OPEN", ["Volví, ¿siguen disponibles?"]],
    ]);
  });

  it("dos mensajes simultáneos de un contacto nuevo crean un solo contacto y un solo lead", async () => {
    await seedFunnel();
    await Promise.all([receiveWhatsApp(webhook([text("wamid.1", "Hola")])), receiveWhatsApp(webhook([text("wamid.2", "¿Precio?")]))]);
    expect(await db.contact.count()).toBe(1);
    const leads = await db.lead.findMany({ include: { messages: true } });
    expect(leads).toHaveLength(1);
    expect(leads[0].messages).toHaveLength(2);
  });

  it("si la base falla al guardar el mensaje, el error sube para que Meta reintente", async () => {
    await seedFunnel();
    // Postgres rechaza el byte nulo en un texto: un error que no es de duplicado.
    await expect(receiveWhatsApp(webhook([text("wamid.1", "Hola\u0000")]))).rejects.toThrow();
    expect(await db.message.count()).toBe(0);
  });

  it("ignora mensajes de otro número de la cuenta y las reacciones; describe imágenes y botones", async () => {
    await seedFunnel();
    await receiveWhatsApp(webhook([text("wamid.x", "otro número")], { phoneId: "999" }));
    expect(await db.message.count()).toBe(0);

    await receiveWhatsApp(
      webhook([
        { from: "56911112222", id: "wamid.r", type: "reaction", reaction: { emoji: "👍" } },
        { from: "56911112222", id: "wamid.i", type: "image", image: { id: "m1", caption: "esta casa" } },
        { from: "56911112222", id: "wamid.b", type: "button", button: { text: "Quiero más info" } },
      ]),
    );
    const bodies = (await db.message.findMany({ orderBy: { createdAt: "asc" } })).map((m) => m.body);
    expect(bodies).toEqual(["[Imagen] esta casa", "Quiero más info"]);
  });

  it("guarda las fotos, documentos y stickers del cliente para verlos en el chat", async () => {
    await seedFunnel();
    const files: Record<string, { bytes: Uint8Array; mimeType: string }> = {
      m1: { bytes: new Uint8Array([1]), mimeType: "image/jpeg" },
      m2: { bytes: new Uint8Array([2]), mimeType: "application/pdf" },
      m3: { bytes: new Uint8Array([3]), mimeType: "image/webp" },
    };
    const asked: { id: string; max?: number }[] = [];
    const api: WhatsAppApi = {
      ...fakeApi().api,
      downloadMedia: async (id, max) => {
        asked.push({ id, max });
        if (!files[id]) throw new Error("no existe");
        return files[id];
      },
    };
    const store: MediaStore = async (file, folder) => `https://blob.test/${folder}/${file.fileName}`;
    await receiveWhatsApp(
      webhook([
        { from: "56911112222", id: "wamid.i", type: "image", image: { id: "m1", caption: "esta casa" } },
        { from: "56911112222", id: "wamid.d", type: "document", document: { id: "m2", filename: "carnet.pdf" } },
        { from: "56911112222", id: "wamid.s", type: "sticker", sticker: { id: "m3" } },
        { from: "56911112222", id: "wamid.v", type: "video", video: { id: "m9" } },
      ]),
      { api, media: { store } },
    );
    const lead = await db.lead.findFirstOrThrow();
    const rows = await db.message.findMany({ orderBy: { externalId: "asc" } });
    expect(rows.map((m) => [m.body, m.mediaType, m.mediaName, m.mediaUrl])).toEqual([
      ["[Documento: carnet.pdf]", "application/pdf", "carnet.pdf", `https://blob.test/leads/${lead.id}/carnet.pdf`],
      ["[Imagen] esta casa", "image/jpeg", "foto.jpeg", `https://blob.test/leads/${lead.id}/foto.jpeg`],
      ["[Sticker]", "image/webp", "foto.webp", `https://blob.test/leads/${lead.id}/foto.webp`],
      // No se pudo descargar: queda el texto.
      ["[Video]", null, null, null],
    ]);
    expect(asked.every((a) => a.max === 25 * 1024 * 1024)).toBe(true);
  });

  it("descarga y transcribe las notas de voz", async () => {
    await seedFunnel();
    const { api } = fakeApi();
    const store: MediaStore = async (file, folder) => `https://blob.test/${folder}/${file.fileName}`;
    await receiveWhatsApp(webhook([{ from: "56911112222", id: "wamid.a", type: "audio", audio: { id: "media1" } }]), {
      api,
      media: { store, transcribe: async () => "Quiero visitar el sábado" },
    });
    const m = await db.message.findFirstOrThrow();
    expect([m.externalId, m.transcript, m.mediaType]).toEqual(["wamid.a", "Quiero visitar el sábado", "audio/ogg; codecs=opus"]);
    expect(m.mediaUrl).toMatch(/audio\.ogg$/);
  });
});

describe("WhatsApp: respuesta a un botón de plantilla", () => {
  const button = (id: string, label: string): WaMessage => ({ from: "56911112222", id, type: "button", button: { text: label } });

  it("asigna un ejecutivo y pausa la IA cuando el cliente toca el botón de la regla", async () => {
    await seedFunnel();
    await saveChannelSettings({ whatsappAi: true });
    const ana = await executive("Ana");
    await db.assignmentRule.create({
      data: { name: "Quiere llamada", trigger: "TEMPLATE_REPLY", buttonText: "Quiero que me llamen", pauseAi: true, executives: { connect: [{ id: ana.id }] } },
    });

    // Un texto normal no dispara la regla aunque diga lo mismo.
    expect(await receiveWhatsApp(webhook([text("wamid.1", "Quiero que me llamen")]))).toHaveLength(1);
    expect((await db.lead.findFirstOrThrow()).assigneeId).toBeNull();

    const toAnswer = await receiveWhatsApp(webhook([button("wamid.2", "quiero que me LLAMEN ")]));
    const lead = await db.lead.findFirstOrThrow({ include: { events: true } });
    expect(toAnswer).toEqual([]);
    expect([lead.assigneeId, lead.aiEnabled]).toEqual([ana.id, false]);
    expect(lead.events.filter((e) => e.reason === "Regla: Quiere llamada").map((e) => e.type).sort()).toEqual(["AI_PAUSED", "ASSIGNED"]);
  });

  it("otro botón no calza con la regla; una regla sin texto calza con cualquiera", async () => {
    await seedFunnel();
    const ana = await executive("Ana");
    const beto = await executive("Beto");
    await db.assignmentRule.create({
      data: { name: "Llamada", trigger: "TEMPLATE_REPLY", buttonText: "Llámenme", priority: 1, executives: { connect: [{ id: ana.id }] } },
    });
    await receiveWhatsApp(webhook([button("wamid.1", "No me interesa")]));
    expect((await db.lead.findFirstOrThrow()).assigneeId).toBeNull();

    await db.assignmentRule.create({
      data: { name: "Cualquiera", trigger: "TEMPLATE_REPLY", executives: { connect: [{ id: beto.id }] } },
    });
    await receiveWhatsApp(webhook([button("wamid.2", "No me interesa")]));
    const lead = await db.lead.findFirstOrThrow();
    expect(lead.assigneeId).toBe(beto.id);
  });
});

describe("WhatsApp: envío y estado de entrega", () => {
  async function waLead() {
    await seedFunnel();
    await receiveWhatsApp(webhook([text("wamid.1", "Hola")]));
    return db.lead.findFirstOrThrow();
  }

  it("envía los mensajes del equipo y de la IA pendientes, una sola vez y en orden", async () => {
    const lead = await waLead();
    const user = await db.user.create({ data: { name: "Eje", email: "e@t.cl", passwordHash: "x", role: "EXECUTIVE" } });
    await db.message.create({ data: { leadId: lead.id, author: "USER", userId: user.id, body: "Hola Ana, soy Eje" } });
    await db.message.create({ data: { leadId: lead.id, author: "AI", body: "¿En qué te ayudo?" } });
    const { api, sent } = fakeApi();
    expect(await deliverOutbound(lead.id, { whatsapp: api })).toBeNull();
    await deliverOutbound(lead.id, { whatsapp: api });

    expect(sent).toEqual([
      { to: "56911112222", text: "Hola Ana, soy Eje" },
      { to: "56911112222", text: "¿En qué te ayudo?" },
    ]);
    const out = await db.message.findMany({ where: { author: { not: "CONTACT" } }, orderBy: { createdAt: "asc" } });
    expect(out.map((m) => [m.deliveryStatus, m.externalId])).toEqual([
      ["SENT", "wamid.out1"],
      ["SENT", "wamid.out2"],
    ]);
  });

  it("espera que Meta confirme cada archivo antes de mandar lo que sigue", async () => {
    const lead = await waLead();
    for (const name of ["plano.pdf", "foto.jpg"]) {
      await db.message.create({
        data: { leadId: lead.id, author: "AI", body: "", mediaUrl: `https://b/${name}`, mediaName: name, mediaType: name.endsWith(".pdf") ? "application/pdf" : "image/jpeg" },
      });
    }
    await db.message.create({ data: { leadId: lead.id, author: "AI", body: "¿Te sirve?" } });
    const { api, sent } = fakeApi();
    const order: string[] = [];
    const sendFile = api.sendFile;
    api.sendFile = async (to, file) => {
      const id = await sendFile(to, file);
      // Meta avisa "sent" un rato después, cuando ya descargó el archivo.
      setTimeout(() => {
        order.push(`sent ${id}`);
        void receiveWhatsApp(webhook([], { statuses: [{ id, status: "sent" }] }));
      }, 100);
      return id;
    };
    const sendText = api.sendText;
    api.sendText = async (to, body) => (order.push("text"), sendText(to, body));

    expect(await deliverOutbound(lead.id, { whatsapp: api })).toBeNull();
    expect(order).toEqual(["sent wamid.out1", "sent wamid.out2", "text"]);
    expect(sent.map((s) => s.text ?? (s.file as { fileName: string }).fileName)).toEqual(["plano.pdf", "foto.jpg", "¿Te sirve?"]);
    const out = await db.message.findMany({ where: { author: "AI" }, orderBy: { createdAt: "asc" } });
    expect(out.map((m) => [m.deliveryStatus, m.externalId])).toEqual([
      ["SENT", "wamid.out1"],
      ["SENT", "wamid.out2"],
      ["SENT", "wamid.out3"],
    ]);
  });

  it("si Meta no confirma el archivo, igual manda el texto al cumplirse la espera", async () => {
    const lead = await waLead();
    await db.message.create({ data: { leadId: lead.id, author: "AI", body: "", mediaUrl: "https://b/foto.jpg", mediaType: "image/jpeg" } });
    await db.message.create({ data: { leadId: lead.id, author: "AI", body: "Mira" } });
    const { api, sent } = fakeApi();
    expect(await deliverOutbound(lead.id, { whatsapp: api, mediaWaitMs: 50 })).toBeNull();
    expect(sent.map((s) => (s.text ? "text" : "file"))).toEqual(["file", "text"]);
    const out = await db.message.findMany({ where: { author: "AI" }, orderBy: { createdAt: "asc" } });
    expect(out.map((m) => m.deliveryStatus)).toEqual(["SENT", "SENT"]);
  });

  it("guarda el motivo cuando WhatsApp rechaza el envío y lo devuelve al ejecutivo", async () => {
    const lead = await waLead();
    await db.message.create({ data: { leadId: lead.id, author: "AI", body: "¿Sigues interesada?" } });
    const reason = "Pasaron más de 24 horas desde el último mensaje del cliente.";
    const { api } = fakeApi(new ChannelSendError(reason, 131047));
    expect(await deliverOutbound(lead.id, { whatsapp: api })).toBe(reason);
    const m = await db.message.findFirstOrThrow({ where: { author: "AI" } });
    expect([m.deliveryStatus, m.deliveryError]).toEqual(["FAILED", reason]);
  });

  it("no manda audios en formatos que WhatsApp no acepta", async () => {
    const lead = await waLead();
    await db.message.create({
      data: { leadId: lead.id, author: "USER", body: "", mediaUrl: "https://blob.test/a.webm", mediaType: "audio/webm" },
    });
    const { api, sent } = fakeApi();
    expect(await deliverOutbound(lead.id, { whatsapp: api })).toMatch(/formato de audio/);
    expect(sent).toEqual([]);
  });

  it("actualiza enviado → entregado → leído sin retroceder, y marca los fallidos", async () => {
    const lead = await waLead();
    await db.message.create({ data: { leadId: lead.id, author: "AI", body: "Uno" } });
    await db.message.create({ data: { leadId: lead.id, author: "AI", body: "Dos" } });
    await deliverOutbound(lead.id, { whatsapp: fakeApi().api });
    const status = (id: string, s: string, errors?: object[]) => webhook([], { statuses: [{ id, status: s, errors }] });

    await receiveWhatsApp(status("wamid.out1", "read"));
    await receiveWhatsApp(status("wamid.out1", "delivered")); // llega tarde
    await receiveWhatsApp(status("wamid.out2", "failed", [{ code: 131026, title: "Undeliverable" }]));

    const out = await db.message.findMany({ where: { author: "AI" }, orderBy: { createdAt: "asc" } });
    expect(out.map((m) => m.deliveryStatus)).toEqual(["READ", "FAILED"]);
    expect(out[1].deliveryError).toMatch(/no tiene WhatsApp/);
  });

  it("el simulador no envía nada", async () => {
    await seedFunnel();
    const { createLead } = await import("@/lib/domain/leads");
    const lead = await createLead({ name: "Sim", channel: "SIMULATOR" });
    await db.message.create({ data: { leadId: lead.id, author: "AI", body: "Hola" } });
    const { api, sent } = fakeApi();
    await deliverOutbound(lead.id, { whatsapp: api });
    expect(sent).toEqual([]);
    expect((await db.message.findFirstOrThrow()).deliveryStatus).toBeNull();
  });
});

describe("WhatsApp: la IA responde", () => {
  it("responde todo lo pendiente en una sola respuesta, aunque lleguen dos webhooks a la vez", async () => {
    await seedFunnel();
    await saveChannelSettings({ whatsappAi: true });
    const [leadId] = await receiveWhatsApp(webhook([text("wamid.1", "Hola"), text("wamid.2", "¿Tienen en Pucón?")]));
    const chat = fakeChat("¡Hola! Sí, tenemos parcelas en Pucón.");
    await Promise.all([answerLead(leadId, { openrouter: chat.client }), answerLead(leadId, { openrouter: chat.client })]);

    const ai = await db.message.findMany({ where: { author: "AI" } });
    expect(ai.map((m) => m.body)).toEqual(["¡Hola! Sí, tenemos parcelas en Pucón."]);
    // Sin token de WhatsApp no sale, y queda a la vista por qué.
    expect([ai[0].deliveryStatus, ai[0].deliveryError]).toEqual(["FAILED", "Falta el token de WhatsApp en Configuración → Credenciales."]);
    expect((await db.lead.findUniqueOrThrow({ where: { id: leadId } })).agentBusyUntil).toBeNull();
  });

  it("espera a que el cliente deje de escribir y responde sus mensajes seguidos de una vez", async () => {
    await seedFunnel();
    await saveChannelSettings({ whatsappAi: true, replyDelaySeconds: 15 });
    const chat = fakeChat("¡Hola! Sí, tenemos parcelas en Pucón.");
    const clients = { openrouter: chat.client };
    const [leadId] = await receiveWhatsApp(webhook([text("wamid.1", "Hola")]));
    const waits: number[] = [];

    // Mientras espera el primero, el cliente manda otro mensaje: el primero no responde.
    await answerLeadWhenQuiet(leadId, {
      clients,
      wait: async (ms) => {
        waits.push(ms);
        await receiveWhatsApp(webhook([text("wamid.2", "¿Tienen en Pucón?")]));
      },
    });
    expect(chat.calls()).toBe(0);

    // El del segundo mensaje espera su plazo sin novedades y responde ambos.
    await answerLeadWhenQuiet(leadId, {
      clients,
      wait: async (ms) => {
        waits.push(ms);
        await db.message.updateMany({ where: { leadId }, data: { createdAt: new Date(Date.now() - ms) } });
      },
    });
    expect(waits).toEqual([15_000, 15_000]);
    expect((await db.message.findMany({ where: { author: "AI" } })).map((m) => m.body)).toEqual([
      "¡Hola! Sí, tenemos parcelas en Pucón.",
    ]);
  });

  it("con espera 0 responde al instante", async () => {
    await seedFunnel();
    await saveChannelSettings({ whatsappAi: true, replyDelaySeconds: 0 });
    const chat = fakeChat("¡Hola!");
    const [leadId] = await receiveWhatsApp(webhook([text("wamid.1", "Hola")]));
    let waited = false;
    await answerLeadWhenQuiet(leadId, { clients: { openrouter: chat.client }, wait: async () => (waited = true) });
    expect(waited).toBe(false);
    expect(await db.message.count({ where: { author: "AI" } })).toBe(1);
  });

  it("los seguimientos automáticos no le escriben a WhatsApp mientras la IA del canal esté apagada", async () => {
    await seedFunnel();
    await setSetting("followUps", { enabled: true, delays: [60_000], sendFrom: 0, sendTo: 24, instructions: "" });
    await receiveWhatsApp(webhook([text("wamid.1", "Hola")]));
    const lead = await db.lead.findFirstOrThrow();
    await db.lead.update({ where: { id: lead.id }, data: { aiEnabled: true, followUpAt: new Date(Date.now() - 1000) } });
    await db.message.create({ data: { leadId: lead.id, author: "AI", body: "¿Te ayudo?", deliveryStatus: "SENT" } });
    const chat = fakeChat("¿Sigues ahí?");
    const run = await runDueFollowUps({ clients: { openrouter: chat.client } });
    expect(run.sent).toBe(0);
    expect(chat.calls()).toBe(0);
  });
});

describe("WhatsApp: firma del webhook", () => {
  it("acepta solo cuerpos firmados con la clave de la app", () => {
    const body = '{"object":"whatsapp_business_account"}';
    const sig = "sha256=" + createHmac("sha256", "secreto").update(body).digest("hex");
    expect(validSignature(body, sig, "secreto")).toBe(true);
    expect(validSignature(body + " ", sig, "secreto")).toBe(false);
    expect(validSignature(body, sig, undefined)).toBe(false);
    expect(validSignature(body, null, "secreto")).toBe(false);
  });
});

describe("WhatsApp: diagnóstico del webhook", () => {
  it("anota los mensajes recibidos y recuerda el último aunque después lleguen solo estados", async () => {
    const t1 = new Date("2026-10-10T13:00:00Z");
    await logWhatsAppWebhook(webhook([text("wamid.d1", "Hola")]), t1);
    expect(await getWhatsAppWebhookLog()).toMatchObject({ result: "ok", detail: "Recibido: 1 mensaje.", lastMessageAt: t1.toISOString() });

    await logWhatsAppWebhook(webhook([], { statuses: [{ id: "x", status: "read" }] }), new Date("2026-10-10T13:05:00Z"));
    expect(await getWhatsAppWebhookLog()).toMatchObject({ result: "ok", lastMessageAt: t1.toISOString() });
  });

  it("avisa cuando Meta manda mensajes de otro número que el configurado", async () => {
    await logWhatsAppWebhook(webhook([text("wamid.d2", "Hola")], { phoneId: "999" }));
    const log = await getWhatsAppWebhookLog();
    expect(log?.result).toBe("otro-numero");
    expect(log?.detail).toContain("999");
  });

  it("anota la firma rechazada", async () => {
    await logWhatsAppWebhook(null);
    expect((await getWhatsAppWebhookLog())?.result).toBe("firma");
  });
});

describe("WhatsApp: diagnóstico con Meta", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function stubGraph(apps: string[]) {
    await saveCredentials({ WHATSAPP_TOKEN: "token" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const body = url.includes("debug_token")
          ? { data: { app_id: "app1", granular_scopes: [{ scope: "whatsapp_business_management", target_ids: ["waba1"] }] } }
          : url.includes("subscribed_apps")
            ? { data: apps.map((id) => ({ whatsapp_business_api_data: { id } })) }
            : { display_phone_number: "+56 9 1111 2222", verified_name: "Empresa", platform_type: "CLOUD_API" };
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
  }

  it("detecta que la app no está suscrita a la cuenta de WhatsApp Business", async () => {
    await stubGraph(["otra-app"]);
    const check = await checkWhatsApp();
    expect(check).toMatchObject({ wabaId: "waba1", subscribed: false, phone: { display: "+56 9 1111 2222", platform: "CLOUD_API" } });
  });

  it("confirma la suscripción", async () => {
    await stubGraph(["app1"]);
    expect((await checkWhatsApp()).subscribed).toBe(true);
  });
});
