import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { saveCredentials } from "@/lib/credentials";
import { ChannelSendError, templateComponents, toApprovedTemplate, type TemplateMessage, type WaWebhook, type WhatsAppApi } from "@/lib/channels/whatsapp";
import { messagePrice } from "@/lib/domain/broadcast-pricing";
import { receiveWhatsApp, saveChannelSettings } from "@/lib/domain/channels";
import { createLead } from "@/lib/domain/leads";
import {
  broadcastRecipients,
  broadcastStats,
  cancelBroadcast,
  countRetriable,
  createBroadcast,
  pauseBroadcast,
  previewBroadcast,
  resumeBroadcast,
  retryFailed,
  runBroadcasts,
  sendBroadcastNow,
  sendBroadcastTest,
  type BroadcastInput,
} from "@/lib/domain/broadcasts";
import { templateDraftError } from "@/lib/domain/broadcast-templates";
import { isOptOutMessage, optBackIn } from "@/lib/domain/contacts";
import { toLocalInput } from "@/lib/dates";
import { executive, seedFunnel } from "./factories";

const TEMPLATE = { name: "preventa", language: "es", body: "Hola {{1}}, tenemos {{2}} para ti.", params: 2 };

let fakes = 0;

function fakeWa(fail: Record<string, ChannelSendError> = {}) {
  const sent: { to: string; params: string[]; from?: string }[] = [];
  const messages: TemplateMessage[] = [];
  const prefix = `wamid.f${++fakes}`;
  const api = {
    sendTemplate: async (to: string, t: TemplateMessage, from?: string) => {
      if (fail[to]) throw fail[to];
      sent.push({ to, params: t.params, from });
      messages.push(t);
      return `${prefix}.${to}`;
    },
  } as unknown as WhatsAppApi;
  return { api, sent, messages };
}

let stages: Awaited<ReturnType<typeof seedFunnel>>;
let userId: string;

beforeEach(async () => {
  stages = await seedFunnel();
  userId = (await executive("Admin")).id;
  await saveChannelSettings({ whatsappAi: true });
});

afterEach(() => vi.unstubAllGlobals());

const input = (rows: BroadcastInput["audience"], extra: Partial<BroadcastInput> = {}): BroadcastInput => ({
  name: "Preventa octubre",
  template: TEMPLATE,
  variables: [{ source: "name", fallback: "hola" }, { source: "column", column: "proyecto", fallback: "parcelas" }],
  audience: rows,
  stageId: stages[1].id,
  dailyLimit: 1000,
  ...extra,
});

describe("envíos masivos", () => {
  it("deja fuera inválidos, repetidos, bloqueados y quienes escribieron hoy", async () => {
    const blocked = await createLead({ name: "Spam", channel: "WHATSAPP", externalId: "56900000001" });
    await db.contact.update({ where: { id: blocked.contactId }, data: { blockedAt: new Date() } });
    const talking = await createLead({ name: "Ana", channel: "WHATSAPP", externalId: "56900000002" });
    await db.message.create({ data: { leadId: talking.id, author: "CONTACT", body: "Hola" } });

    const preview = await previewBroadcast(
      input({
        kind: "rows",
        countryCode: "56",
        rows: [
          { phone: "+56 9 1111 2222", name: "Camila Rojas", values: { proyecto: "Los Robles" } },
          { phone: "911112222", name: "Camila otra vez" },
          { phone: "123" },
          { phone: "56900000001" },
          { phone: "56900000002" },
          { phone: "56933334444" },
        ],
      }),
    );
    expect(preview.total).toBe(6);
    expect(preview.excluded).toEqual({ invalid: 1, duplicate: 1, blocked: 1, optedOut: 0, active: 1, missing: 0 });
    expect(preview.count).toBe(2);
    expect(preview.sample?.body).toBe("Hola Camila, tenemos Los Robles para ti.");
  });

  it("sin texto de reemplazo, deja fuera a quien no tiene el dato", async () => {
    const preview = await previewBroadcast(
      input(
        { kind: "rows", rows: [{ phone: "+56911112222" }, { phone: "+56933334444", name: "Jorge" }] },
        { variables: [{ source: "name" }, { source: "text", text: "una oferta" }] },
      ),
    );
    expect(preview.excluded.missing).toBe(1);
    expect(preview.count).toBe(1);
  });

  it("envía la plantilla, crea leads en la etapa elegida y respeta los leads abiertos", async () => {
    const existing = await createLead({ name: "Jorge", channel: "WHATSAPP", externalId: "56933334444" });
    const b = await createBroadcast(
      input({
        kind: "rows",
        rows: [
          { phone: "+56911112222", name: "Camila Rojas", values: { proyecto: "Los Robles" } },
          { phone: "+56933334444", values: { proyecto: "" } },
        ],
      }),
      userId,
    );
    const { api, sent } = fakeWa();
    expect(await runBroadcasts({ api })).toMatchObject({ sent: 2, failed: 0 });
    expect(sent.map((s) => s.params).sort()).toEqual([["Camila", "Los Robles"], ["Jorge", "parcelas"]]);

    const camila = await db.lead.findFirstOrThrow({ where: { contact: { externalId: "56911112222" } }, include: { messages: true } });
    expect(camila.stageId).toBe(stages[1].id);
    expect(camila.aiEnabled).toBe(true);
    expect(camila.messages[0]).toMatchObject({ author: "USER", userId, body: "Hola Camila, tenemos Los Robles para ti.", deliveryStatus: "SENT" });
    // Jorge ya tenía un lead abierto: sigue en su etapa, sin lead nuevo.
    expect(await db.lead.count({ where: { contactId: existing.contactId } })).toBe(1);
    expect((await db.lead.findUniqueOrThrow({ where: { id: existing.id } })).stageId).toBe(stages[0].id);
    expect((await db.broadcast.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("DONE");

    // Una segunda corrida no vuelve a escribirles.
    expect(await runBroadcasts({ api })).toMatchObject({ sent: 0 });
    expect(sent).toHaveLength(2);
  });

  it("cuenta entregados, leídos y respuestas con los avisos de WhatsApp", async () => {
    await saveCredentials({ WHATSAPP_PHONE_NUMBER_ID: "PHONE" });
    const b = await createBroadcast(
      input({ kind: "rows", rows: ["+56911110001", "+56911110002", "+56911110003"].map((phone) => ({ phone, name: "Persona" })) }),
      userId,
    );
    const { api } = fakeWa({ "56911110003": new ChannelSendError("WhatsApp no pudo entregarlo.", 131026) });
    await runBroadcasts({ api });
    const wamid = async (phone: string) =>
      (await db.message.findFirstOrThrow({ where: { lead: { contact: { externalId: phone } } } })).externalId!;
    const value = (v: object): WaWebhook => ({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "PHONE" }, ...v } }] }],
    });
    await receiveWhatsApp(value({ statuses: [{ id: await wamid("56911110001"), status: "read" }, { id: await wamid("56911110002"), status: "delivered" }] }));
    await receiveWhatsApp(value({ messages: [{ from: "56911110002", id: "wamid.in1", type: "text", text: { body: "Me interesa" } }] }));

    expect((await broadcastStats([b.id])).get(b.id)).toEqual({
      total: 3, pending: 0, sent: 2, delivered: 2, read: 2, replied: 1, failed: 1, skipped: 0,
    });
    const replied = await broadcastRecipients(b.id, "respondieron");
    expect(replied.map((r) => r.phone)).toEqual(["56911110002"]);
    expect(replied[0].stageName).toBe(stages[1].name);
    expect((await broadcastRecipients(b.id, "fallaron"))[0].error).toBe("WhatsApp no pudo entregarlo.");
  });

  it("no pasa el máximo diario y sigue cuando hay cupo", async () => {
    await createBroadcast(
      input({ kind: "rows", rows: ["+56911110001", "+56911110002", "+56911110003"].map((phone) => ({ phone })) }, { dailyLimit: 2 }),
      userId,
    );
    const { api, sent } = fakeWa();
    const run = await runBroadcasts({ api });
    expect(run.sent).toBe(2);
    expect(run.reason).toMatch(/máximo/);
    await db.broadcastRecipient.updateMany({ where: { status: "SENT" }, data: { sentAt: new Date(Date.now() - 25 * 3600_000) } });
    expect((await runBroadcasts({ api })).sent).toBe(1);
    expect(sent).toHaveLength(3);
  });

  it("se pausa si la plantilla o el token no sirven, y sigue al reanudar", async () => {
    const b = await createBroadcast(input({ kind: "rows", rows: [{ phone: "+56911110001" }, { phone: "+56911110002" }] }), userId);
    const broken = fakeWa({ "56911110001": new ChannelSendError("La plantilla no existe.", 132001) });
    const run = await runBroadcasts({ api: broken.api });
    // El otro de la misma tanda salió en paralelo; al que falló no le queda un mensaje fallido en el chat.
    expect(run).toMatchObject({ sent: 1, reason: "La plantilla no existe." });
    expect(await db.broadcast.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ status: "PAUSED", note: "La plantilla no existe." });
    expect(await db.message.count({ where: { lead: { contact: { externalId: "56911110001" } } } })).toBe(0);

    await resumeBroadcast(b.id);
    const { api, sent } = fakeWa();
    expect((await runBroadcasts({ api })).sent).toBe(1);
    expect(sent.map((s) => s.to)).toEqual(["56911110001"]);
  });

  it("al cancelar, quienes faltan quedan sin enviar", async () => {
    const b = await createBroadcast(input({ kind: "rows", rows: [{ phone: "+56911110001" }] }), userId);
    await cancelBroadcast(b.id);
    const { api, sent } = fakeWa();
    await runBroadcasts({ api });
    expect(sent).toHaveLength(0);
    expect((await broadcastStats([b.id])).get(b.id)?.skipped).toBe(1);
  });

  it("toma los destinatarios del funnel por etapa y salta a quien se bloqueó después", async () => {
    const a = await createLead({ name: "Ana Pérez", channel: "WHATSAPP", externalId: "56911110001" });
    const c = await createLead({ name: "Carlos", channel: "WHATSAPP", externalId: "56911110002" });
    await createLead({ name: "Otra etapa", channel: "WHATSAPP", externalId: "56911110003" }, { stageId: stages[2].id });
    const preview = await previewBroadcast(
      input({ kind: "funnel", funnelId: stages[0].funnelId, stageId: stages[0].id, status: "OPEN" }, { variables: [{ source: "name" }, { source: "text", text: "una oferta" }] }),
    );
    expect(preview.count).toBe(2);
    const b = await createBroadcast(
      input({ kind: "funnel", funnelId: stages[0].funnelId, stageId: stages[0].id }, { variables: [{ source: "name" }, { source: "text", text: "una oferta" }] }),
      userId,
    );
    await db.contact.update({ where: { id: c.contactId }, data: { blockedAt: new Date() } });
    const { api, sent } = fakeWa();
    await runBroadcasts({ api });
    expect(sent).toEqual([{ to: "56911110001", params: ["Ana", "una oferta"], from: undefined }]);
    expect((await broadcastStats([b.id])).get(b.id)).toMatchObject({ sent: 1, skipped: 1 });
    expect(a.id).toBeTruthy();
  });
});

describe("plantillas aprobadas", () => {
  it("cuenta las variables y marca las que todavía no se pueden enviar", () => {
    const body = { type: "BODY", text: "Hola {{1}}, mira {{2}}" };
    expect(toApprovedTemplate({ name: "a", language: "es", status: "APPROVED", components: [body, { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY" }] }] })).toMatchObject({
      params: 2,
      unsupported: null,
    });
    expect(toApprovedTemplate({ name: "b", language: "es", status: "APPROVED", components: [{ type: "HEADER", format: "IMAGE" }, body] })).toMatchObject({ header: "image", unsupported: null });
    expect(toApprovedTemplate({ name: "e", language: "es", status: "APPROVED", components: [{ type: "HEADER", format: "LOCATION" }, body] }).unsupported).toMatch(/ubicación/);
    expect(toApprovedTemplate({ name: "c", language: "es", status: "APPROVED", parameter_format: "NAMED", components: [{ type: "BODY", text: "Hola {{nombre}}" }] }).unsupported).toMatch(/nombre/);
    expect(
      toApprovedTemplate({ name: "d", language: "es", status: "APPROVED", components: [body, { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Sí" }, { type: "URL", text: "Ver", url: "https://x.cl/{{1}}" }] }] }),
    ).toMatchObject({ unsupported: null, urlButtons: [{ index: 1, text: "Ver", url: "https://x.cl/{{1}}" }] });
    expect(toApprovedTemplate({ name: "f", language: "es", status: "APPROVED", components: [body, { type: "BUTTONS", buttons: [{ type: "COPY_CODE" }] }] }).unsupported).toMatch(/código/);
  });
});

describe("envíos masivos sin WhatsApp conectado", () => {
  it("se pausa antes de crear leads", async () => {
    const b = await createBroadcast(
      {
        name: "Prueba",
        template: TEMPLATE,
        variables: [{ source: "text", text: "Ana" }, { source: "text", text: "algo" }],
        audience: { kind: "rows", rows: [{ phone: "+56911110001" }] },
        stageId: stages[0].id,
        dailyLimit: 10,
      },
      userId,
    );
    expect(await runBroadcasts()).toMatchObject({ sent: 0, reason: expect.stringMatching(/token/) });
    expect(await db.broadcast.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ status: "PAUSED" });
    expect(await db.lead.count()).toBe(0);
  });
});

describe("envíos masivos: programar, baja y prueba", () => {
  const wa = (from: string, body: string, id: string): WaWebhook => ({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "PHONE" }, messages: [{ from, id, type: "text", text: { body } }] } }] }],
  });

  it("reconoce cuando alguien pide la baja, pero no cualquier \"no me interesa\"", () => {
    for (const t of ["BAJA", "baja.", "No me interesa, gracias", "Hola, no me interesa", "STOP", "no quiero recibir más mensajes", "Darme de baja por favor"]) {
      expect(isOptOutMessage(t), t).toBe(true);
    }
    for (const t of ["No me interesa ese lote, ¿tienen otro?", "bajaron el precio?", "me interesa", "stop motion"]) {
      expect(isOptOutMessage(t), t).toBe(false);
    }
  });

  it("quien responde BAJA queda fuera de los envíos siguientes, y se le puede volver a incluir", async () => {
    await saveCredentials({ WHATSAPP_PHONE_NUMBER_ID: "PHONE" });
    await receiveWhatsApp(wa("56911110001", "BAJA", "wamid.baja"));
    const lead = await db.lead.findFirstOrThrow({ where: { contact: { externalId: "56911110001" } }, include: { contact: true, events: true } });
    expect(lead.contact.optedOutAt).not.toBeNull();
    expect(lead.events.map((e) => e.type)).toContain("OPTED_OUT");

    // Escribió hoy, así que también cuenta como "conversando"; pasado un día, solo la baja lo deja fuera.
    await db.message.updateMany({ data: { createdAt: new Date(Date.now() - 2 * 86_400_000) } });
    const rows = { kind: "rows" as const, rows: [{ phone: "+56911110001", name: "Ana" }, { phone: "+56911110002", name: "Luis" }] };
    const vars = { variables: [{ source: "name" as const }, { source: "text" as const, text: "algo" }] };
    expect((await previewBroadcast(input(rows, vars))).excluded).toMatchObject({ optedOut: 1, active: 0 });

    await optBackIn(lead.id, { actor: "USER", userId });
    expect((await previewBroadcast(input(rows, vars))).excluded.optedOut).toBe(0);
  });

  it("si pide la baja después de armar la lista, no se le envía", async () => {
    const b = await createBroadcast(
      input({ kind: "rows", rows: [{ phone: "+56911110001", name: "Ana" }, { phone: "+56911110002", name: "Luis" }] }, { variables: [{ source: "name" }, { source: "text", text: "algo" }] }),
      userId,
    );
    const ana = await createLead({ name: "Ana", channel: "WHATSAPP", externalId: "56911110001" });
    await db.contact.update({ where: { id: ana.contactId }, data: { optedOutAt: new Date() } });
    const { api, sent } = fakeWa();
    await runBroadcasts({ api });
    expect(sent.map((s) => s.to)).toEqual(["56911110002"]);
    expect((await broadcastRecipients(b.id, "fallaron"))[0].error).toMatch(/baja|no recibir/);
  });

  it("un envío programado espera su hora, o sale al tocar enviar ahora", async () => {
    const rows = { kind: "rows" as const, rows: [{ phone: "+56911110001", name: "Ana" }] };
    const vars = { variables: [{ source: "name" as const }, { source: "text" as const, text: "algo" }] };
    await expect(createBroadcast(input(rows, { ...vars, scheduledAt: toLocalInput(new Date(Date.now() - 3600_000)) }), userId)).rejects.toThrow(/ya pasó/);

    const b = await createBroadcast(input(rows, { ...vars, scheduledAt: toLocalInput(new Date(Date.now() + 3 * 3600_000)) }), userId);
    expect(b.status).toBe("SCHEDULED");
    expect(Math.abs(b.scheduledAt!.getTime() - (Date.now() + 3 * 3600_000))).toBeLessThan(61_000);
    const { api, sent } = fakeWa();
    await runBroadcasts({ api });
    expect(sent).toHaveLength(0);

    // Llegó la hora.
    await db.broadcast.update({ where: { id: b.id }, data: { scheduledAt: new Date(Date.now() - 1000) } });
    await runBroadcasts({ api });
    expect(sent).toHaveLength(1);
    expect((await db.broadcast.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("DONE");

    const later = await createBroadcast(
      input({ kind: "rows", rows: [{ phone: "+56911110002", name: "Luis" }] }, { ...vars, scheduledAt: toLocalInput(new Date(Date.now() + 86_400_000)) }),
      userId,
    );
    await sendBroadcastNow(later.id);
    await runBroadcasts({ api });
    expect(sent.map((s) => s.to)).toEqual(["56911110001", "56911110002"]);
    await cancelBroadcast(later.id);
    expect((await db.broadcast.findUniqueOrThrow({ where: { id: later.id } })).status).toBe("DONE");
  });

  it("la prueba llega al número del equipo con los datos de la primera persona, sin crear leads", async () => {
    const { api, sent } = fakeWa();
    const res = await sendBroadcastTest(
      input({ kind: "rows", countryCode: "56", rows: [{ phone: "911112222", name: "Camila Rojas", values: { proyecto: "Los Robles" } }] }),
      "+56 9 8765 4321",
      { api },
    );
    expect(res).toEqual({ phone: "+56987654321", body: "Hola Camila, tenemos Los Robles para ti." });
    expect(sent).toEqual([{ to: "56987654321", params: ["Camila", "Los Robles"], from: undefined }]);
    expect(await db.lead.count()).toBe(0);
    await expect(sendBroadcastTest(input({ kind: "rows", rows: [] }), "123", { api })).rejects.toThrow(/código de país/);
  });

  it("revisa las plantillas nuevas antes de mandarlas a Meta", () => {
    const ok = { name: "preventa_octubre", language: "es", category: "MARKETING" as const, text: "Hola {{1}}, mira {{2}} hoy.", examples: ["María", "Los Robles"] };
    expect(templateDraftError(ok)).toBeNull();
    expect(templateDraftError({ ...ok, name: "Preventa Octubre" })).toMatch(/minúsculas/);
    expect(templateDraftError({ ...ok, text: "Hola {{1}}, mira {{3}} hoy." })).toMatch(/Falta \{\{2\}\}/);
    expect(templateDraftError({ ...ok, text: "{{1}}, hola" })).toMatch(/empiece o termine/);
    expect(templateDraftError({ ...ok, examples: ["María", " "] })).toMatch(/ejemplo/);
    expect(templateDraftError({ ...ok, text: "Hola {{nombre}}." })).toMatch(/números/);
  });
});

describe("envíos masivos: archivo, botones, A/B, reenvío y costo", () => {
  const vars = { variables: [{ source: "name" as const }, { source: "text" as const, text: "algo" }] };
  const people = (n: number, from = 1) =>
    Array.from({ length: n }, (_, i) => ({ phone: `+569111100${String(from + i).padStart(2, "0")}`, name: `Persona ${from + i}` }));

  it("arma los componentes con archivo arriba, cuerpo y botón de enlace", () => {
    expect(
      templateComponents({ name: "x", language: "es", params: ["Ana"], header: { kind: "document", url: "https://f/x.pdf", fileName: "x.pdf" }, buttons: [{ index: 1, text: "abc" }] }),
    ).toEqual([
      { type: "header", parameters: [{ type: "document", document: { link: "https://f/x.pdf", filename: "x.pdf" } }] },
      { type: "body", parameters: [{ type: "text", text: "Ana" }] },
      { type: "button", sub_type: "url", index: "1", parameters: [{ type: "text", text: "abc" }] },
    ]);
  });

  it("envía la imagen elegida y el final del enlace de cada persona", async () => {
    const image = await db.mediaFile.create({ data: { title: "Portada", url: "https://blob/portada.png", mimeType: "image/png", fileName: "portada.png" } });
    const pdf = await db.mediaFile.create({ data: { title: "Plano", url: "https://blob/plano.pdf", mimeType: "application/pdf", fileName: "plano.pdf" } });
    const template = { ...TEMPLATE, header: "image" as const, urlButtons: [0] };
    const base = input(
      { kind: "rows", rows: [{ phone: "+56911110001", name: "Ana", values: { proyecto: "Robles", codigo: "R1" } }] },
      { template, buttonVariables: [{ source: "column", column: "codigo" }] },
    );
    await expect(previewBroadcast(base)).rejects.toThrow(/imagen/);
    await expect(previewBroadcast({ ...base, headerFileId: pdf.id })).rejects.toThrow(/JPG o PNG/);

    await createBroadcast({ ...base, headerFileId: image.id }, userId);
    const { api, messages } = fakeWa();
    await runBroadcasts({ api });
    expect(messages[0]).toMatchObject({
      params: ["Ana", "Robles"],
      header: { kind: "image", url: "https://blob/portada.png" },
      buttons: [{ index: 0, text: "R1" }],
    });
    const msg = await db.message.findFirstOrThrow({ where: { lead: { contact: { externalId: "56911110001" } } } });
    expect(msg).toMatchObject({ mediaUrl: "https://blob/portada.png", mediaType: "image/png" });
  });

  it("una prueba A/B reparte la lista en dos mitades y se maneja junta", async () => {
    const other = { name: "preventa_b", language: "es", body: "{{1}}: oferta {{2}}.", params: 2 };
    const a = await createBroadcast(input({ kind: "rows", rows: people(10) }, { ...vars, variantB: { template: other, ...vars } }), userId);
    const group = await db.broadcast.findMany({ where: { abGroup: a.abGroup! }, include: { _count: { select: { recipients: true } } }, orderBy: { name: "asc" } });
    expect(group.map((g) => [g.name, g.templateName, g._count.recipients])).toEqual([
      ["Preventa octubre · A", "preventa", 5],
      ["Preventa octubre · B", "preventa_b", 5],
    ]);
    await pauseBroadcast(a.id);
    expect((await db.broadcast.findMany({ where: { abGroup: a.abGroup! } })).map((g) => g.status)).toEqual(["PAUSED", "PAUSED"]);
    await resumeBroadcast(a.id);
    const { api, messages } = fakeWa();
    await runBroadcasts({ api });
    expect(messages.filter((m) => m.name === "preventa_b")).toHaveLength(5);
    await expect(createBroadcast(input({ kind: "rows", rows: people(4) }, { ...vars, variantB: { template: TEMPLATE, ...vars } }), userId)).rejects.toThrow(/distintas/);
  });

  it("reenvía solo a quienes no leyeron", async () => {
    await saveCredentials({ WHATSAPP_PHONE_NUMBER_ID: "PHONE" });
    const first = await createBroadcast(input({ kind: "rows", rows: people(3) }, vars), userId);
    await runBroadcasts({ api: fakeWa().api });
    const wamid = async (phone: string) => (await db.message.findFirstOrThrow({ where: { lead: { contact: { externalId: phone } } } })).externalId!;
    await receiveWhatsApp({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "PHONE" }, statuses: [{ id: await wamid("56911110001"), status: "read" }] } }] }],
    });
    const preview = await previewBroadcast(input({ kind: "resend", broadcastId: first.id }, vars));
    expect(preview.count).toBe(2);
    const again = await createBroadcast(input({ kind: "resend", broadcastId: first.id }, vars), userId);
    expect(again.resentFromId).toBe(first.id);
    expect((await db.broadcastRecipient.findMany({ where: { broadcastId: again.id } })).map((r) => r.phone).sort()).toEqual(["56911110002", "56911110003"]);
  });

  it("estima el costo según el país y el tipo de plantilla", async () => {
    expect(messagePrice("56911110001", "MARKETING")).toBeCloseTo(0.0889);
    expect(messagePrice("56911110001", "UTILITY")).toBeCloseTo(0.02);
    expect(messagePrice("5215512345678", "MARKETING")).toBeCloseTo(0.0305);
    const preview = await previewBroadcast(input({ kind: "rows", rows: people(2) }, { ...vars, template: { ...TEMPLATE, category: "MARKETING" } }));
    expect(preview.cost).toBeCloseTo(0.1778);
  });
});

describe("envíos masivos: Meta rechaza después de aceptar", () => {
  it("si falla por la cuenta (sin medio de pago), se pausa con el motivo en español", async () => {
    await saveCredentials({ WHATSAPP_PHONE_NUMBER_ID: "PHONE" });
    const rows = Array.from({ length: 30 }, (_, i) => ({ phone: `+5691111${String(i).padStart(4, "0")}`, name: "Persona" }));
    const b = await createBroadcast(input({ kind: "rows", rows }, { variables: [{ source: "name" }, { source: "text", text: "algo" }], dailyLimit: 5 }), userId);
    await runBroadcasts({ api: fakeWa().api });
    const first = await db.message.findFirstOrThrow({ where: { externalId: { not: null } } });
    await receiveWhatsApp({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "PHONE" }, statuses: [{ id: first.externalId!, status: "failed", errors: [{ code: 131042, title: "Business eligibility payment issue", error_data: { details: "Message failed to send because your WhatsApp Business account currency is not configured." } }] }] } }] }],
    });
    expect((await db.message.findUniqueOrThrow({ where: { id: first.id } })).deliveryError).toMatch(/medio de pago/);
    expect(await db.broadcast.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ status: "PAUSED", note: expect.stringMatching(/Facturación/) });
  });

  it("reintentar vuelve a enviar a quienes fallaron, sin duplicar el mensaje en el chat", async () => {
    await saveCredentials({ WHATSAPP_PHONE_NUMBER_ID: "PHONE" });
    const rows = [
      { phone: "+56911110001", name: "Ana" },
      { phone: "+56911110002", name: "Bea" },
    ];
    const b = await createBroadcast(input({ kind: "rows", rows }, { variables: [{ source: "name" }, { source: "text", text: "algo" }] }), userId);
    await runBroadcasts({ api: fakeWa({ "56911110002": new ChannelSendError("Número no válido.", 131026) }).api });
    const ana = await db.message.findFirstOrThrow({ where: { externalId: { not: null } } });
    await receiveWhatsApp({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "PHONE" }, statuses: [{ id: ana.externalId!, status: "failed", errors: [{ code: 131042, title: "payment" }] }] } }] }],
    });
    expect(await countRetriable(b.id)).toBe(2);

    expect(await retryFailed(b.id)).toBe(2);
    expect(await db.message.findUnique({ where: { id: ana.id } })).toBeNull();
    const wa = fakeWa();
    await runBroadcasts({ api: wa.api });
    expect(wa.sent.map((x) => x.to).sort()).toEqual(["56911110001", "56911110002"]);
    expect(await countRetriable(b.id)).toBe(0);
    expect(await db.broadcast.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ status: "DONE", note: null });
    expect(await db.message.count({ where: { lead: { contact: { externalId: "56911110001" } } } })).toBe(1);
  });
});
