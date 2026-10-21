import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { createLead } from "@/lib/domain/leads";
import { setSetting } from "@/lib/settings";
import { runAgent } from "@/lib/ai/agent";
import type { AiConfig } from "@/lib/ai/config";
import type { AnthropicClient } from "@/lib/ai/providers";
import type { WhatsAppApi } from "@/lib/channels/whatsapp";
import type { MessengerApi } from "@/lib/channels/messenger";
import { deliverOutbound } from "@/lib/domain/channels";
import { addMediaFile, sendLibraryFiles, sendUploadedFile } from "@/lib/domain/files";
import type { MediaStore } from "@/lib/media";
import { executive, seedFunnel } from "./factories";

const store: MediaStore = async (file, folder) => `https://blob.test/${folder}/${file.fileName}`;
const pdf = { bytes: new Uint8Array([37, 80, 68, 70]), mimeType: "application/pdf", fileName: "masterplan.pdf" };

type Scripted = { stop_reason: string; content: object[] };

function fakeAnthropic(script: Scripted[]) {
  const requests: { system: { text: string }[] | string; messages: object[] }[] = [];
  const client = {
    beta: {
      messages: {
        create: async (req: (typeof requests)[number]) => {
          requests.push(structuredClone(req));
          const next = script.shift();
          if (!next) throw new Error("Sin respuestas guionadas");
          return { id: "msg", type: "message", role: "assistant", model: "x", usage: {}, ...next };
        },
      },
    },
  } as unknown as AnthropicClient;
  return { clients: { anthropic: client }, requests };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(async () => {
  await seedFunnel();
  await setSetting<AiConfig>("ai", { provider: "anthropic", model: "modelo-x", effort: "medium" });
});

describe("archivos para la IA", () => {
  it("guarda archivos subidos o por enlace y valida los datos", async () => {
    const up = await addMediaFile({ title: "Masterplan", description: "Plano de lotes", file: pdf }, store);
    expect([up.url, up.mimeType, up.fileName, up.size]).toEqual(["https://blob.test/archivos/masterplan.pdf", "application/pdf", "masterplan.pdf", 4]);
    const link = await addMediaFile({ title: "Foto", description: "", url: "https://cdn.test/fotos/vista%20aerea.jpg" });
    expect([link.mimeType, link.fileName]).toEqual(["image/jpeg", "vista aerea.jpg"]);
    await expect(addMediaFile({ title: "X", description: "", url: "http://inseguro.test/a.pdf" })).rejects.toThrow(/https/);
    const unnamed = await addMediaFile({ title: "", product: " Proyecto Sur ", description: "", file: { ...pdf, fileName: "vista_aerea-2.kmz", mimeType: "" } }, store);
    expect([unnamed.title, unnamed.product, unnamed.mimeType]).toEqual(["vista aerea 2", "Proyecto Sur", "application/vnd.google-earth.kmz"]);
    await expect(addMediaFile({ title: "Y", description: "" })).rejects.toThrow(/enlace/);
  });

  it("rechaza enlaces que pasan el máximo de WhatsApp para su tipo", async () => {
    const MB = 1024 * 1024;
    vi.stubGlobal("fetch", async () => new Response(null, { headers: { "content-length": String(20 * MB) } }));
    await expect(addMediaFile({ title: "", description: "", url: "https://cdn.test/recorrido.mp4" })).rejects.toThrow(
      /20\.0 MB y WhatsApp acepta hasta 16 MB en videos/,
    );
    const brochure = await addMediaFile({ title: "", description: "", url: "https://cdn.test/brochure.pdf" });
    expect([brochure.title, brochure.size]).toEqual(["brochure", 20 * MB]);
  });

  it("la IA ve el catálogo y envía un archivo antes de su respuesta", async () => {
    await addMediaFile({ title: "Masterplan", description: "Envíalo si pide el plano", file: pdf }, store);
    const lead = await createLead({ name: "Ana", channel: "SIMULATOR" });
    await db.message.create({ data: { leadId: lead.id, author: "CONTACT", body: "¿Me mandas el plano?" } });
    const { clients, requests } = fakeAnthropic([
      {
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "t1", name: "send_file", input: { file: "masterplan", caption: "Aquí va el plano" } }],
      },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Te lo acabo de enviar. ¿Qué lote te interesa?" }] },
    ]);
    await runAgent(lead.id, clients);

    expect(JSON.stringify(requests[0].system)).toContain("- Masterplan (documento): Envíalo si pide el plano");
    const ai = await db.message.findMany({ where: { leadId: lead.id, author: "AI" }, orderBy: { createdAt: "asc" } });
    expect(ai.map((m) => [m.body, m.mediaUrl, m.mediaName])).toEqual([
      ["Aquí va el plano", "https://blob.test/archivos/masterplan.pdf", "masterplan.pdf"],
      ["Te lo acabo de enviar. ¿Qué lote te interesa?", null, null],
    ]);
  });

  it("un archivo desconocido devuelve error a la IA con la lista disponible", async () => {
    await addMediaFile({ title: "Catálogo", description: "", file: pdf }, store);
    const lead = await createLead({ name: "Ana", channel: "SIMULATOR" });
    await db.message.create({ data: { leadId: lead.id, author: "CONTACT", body: "Hola" } });
    const { clients, requests } = fakeAnthropic([
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "send_file", input: { file: "Precios", caption: "" } }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Hola" }] },
    ]);
    await runAgent(lead.id, clients);
    expect(JSON.stringify(requests[1].messages)).toContain("Archivos disponibles: Catálogo");
    expect(await db.message.count({ where: { mediaUrl: { not: null } } })).toBe(0);
  });
});

describe("archivos agrupados por producto", () => {
  async function seedProducts() {
    for (const [title, product] of [
      ["Brochure", "Proyecto Norte"],
      ["Foto 1", "Proyecto Norte"],
      ["Foto 2", "Proyecto Norte"],
      ["Brochure", "Proyecto Sur"],
      ["Condiciones", ""],
    ]) {
      await addMediaFile({ title, product, description: "", file: { ...pdf, fileName: `${title}.pdf` } }, store);
    }
    const lead = await createLead({ name: "Ana", channel: "SIMULATOR" });
    await db.message.create({ data: { leadId: lead.id, author: "CONTACT", body: "Mándame todo del Proyecto Norte" } });
    return lead;
  }

  it("la IA ve el catálogo por producto y envía todo el set de un producto", async () => {
    const lead = await seedProducts();
    const { clients, requests } = fakeAnthropic([
      {
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "t1", name: "send_file", input: { file: "", product: "proyecto norte", caption: "Todo del proyecto" } }],
      },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Listo" }] },
    ]);
    await runAgent(lead.id, clients);

    const system = JSON.stringify(requests[0].system);
    expect(system).toContain("Producto: Proyecto Norte\\n- Brochure (documento)\\n- Foto 1 (documento)");
    expect(system).toContain("Sin producto:\\n- Condiciones");
    expect(JSON.stringify(requests[1].messages)).toContain("3 archivos enviados al cliente");
    const ai = await db.message.findMany({ where: { leadId: lead.id, author: "AI" }, orderBy: { createdAt: "asc" } });
    expect(ai.map((m) => [m.body, m.mediaName])).toEqual([
      ["Todo del proyecto", "Brochure.pdf"],
      ["", "Foto 1.pdf"],
      ["", "Foto 2.pdf"],
      ["Listo", null],
    ]);
  });

  it("un nombre repetido entre productos pide el producto; con él envía solo ese", async () => {
    const lead = await seedProducts();
    const { clients, requests } = fakeAnthropic([
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "send_file", input: { file: "brochure", product: "", caption: "" } }] },
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t2", name: "send_file", input: { file: "brochure", product: "Proyecto Sur", caption: "" } }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Listo" }] },
    ]);
    await runAgent(lead.id, clients);
    expect(JSON.stringify(requests[1].messages)).toContain("indica también el producto");
    const files = await db.message.findMany({ where: { leadId: lead.id, mediaUrl: { not: null } } });
    expect(files.map((m) => m.mediaName)).toEqual(["Brochure.pdf"]);
    expect(await db.mediaFile.count({ where: { url: files[0].mediaUrl!, product: "Proyecto Sur" } })).toBe(1);
  });
});

describe("envío de archivos por los canales", () => {
  it("WhatsApp manda el documento con el texto como pie", async () => {
    const lead = await createLead({ name: "Ana", channel: "WHATSAPP", externalId: "56911112222" });
    await db.message.create({
      data: { leadId: lead.id, author: "AI", body: "Aquí va", mediaUrl: "https://b/plano.pdf", mediaType: "application/pdf", mediaName: "plano.pdf" },
    });
    const sent: object[] = [];
    const api: WhatsAppApi = {
      sendText: async (to, body) => (sent.push({ to, body }), "w1"),
      sendAudio: async () => "w2",
      sendFile: async (to, file) => (sent.push({ to, ...file }), "w3"),
      downloadMedia: async () => ({ bytes: new Uint8Array(), mimeType: "" }),
    };
    expect(await deliverOutbound(lead.id, { whatsapp: api })).toBeNull();
    expect(sent).toEqual([{ to: "56911112222", kind: "document", url: "https://b/plano.pdf", fileName: "plano.pdf", caption: "Aquí va" }]);
    const m = await db.message.findFirstOrThrow({ where: { author: "AI" } });
    expect([m.deliveryStatus, m.externalId]).toEqual(["SENT", "w3"]);
  });

  it("Instagram manda la imagen y luego el texto", async () => {
    const lead = await createLead({ name: "Ana", channel: "INSTAGRAM", externalId: "user-1" });
    await db.message.create({
      data: { leadId: lead.id, author: "AI", body: "Así se ve", mediaUrl: "https://b/foto.jpg", mediaType: "image/jpeg", mediaName: "foto.jpg" },
    });
    const sent: object[] = [];
    const api: MessengerApi = {
      sendText: async (_p, to, text) => (sent.push({ to, text }), "m1"),
      sendAudio: async () => "m2",
      sendFile: async (_p, to, file) => (sent.push({ to, ...file }), "m3"),
      profileName: async () => null,
      download: async () => ({ bytes: new Uint8Array(), mimeType: "" }),
    };
    expect(await deliverOutbound(lead.id, { messenger: api })).toBeNull();
    expect(sent).toEqual([
      { to: "user-1", kind: "image", url: "https://b/foto.jpg" },
      { to: "user-1", text: "Así se ve" },
    ]);
  });
});

describe("archivos que manda un ejecutivo desde el chat", () => {
  const MB = 1024 * 1024;
  const blob = (leadId: string, name: string) => `https://abc.public.blob.vercel-storage.com/leads/${leadId}/archivos/${name}`;

  it("manda archivos de la biblioteca en el orden del catálogo, con el texto de pie en el primero", async () => {
    const plano = await addMediaFile({ title: "Plano", product: "Norte", description: "", file: pdf }, store);
    const foto = await addMediaFile({ title: "Foto", product: "Norte", description: "", file: { ...pdf, fileName: "foto.png", mimeType: "image/png" } }, store);
    const lead = await createLead({ name: "Ana", channel: "SIMULATOR" });
    const user = await executive("Pedro");
    await sendLibraryFiles(lead.id, user.id, [foto.id, plano.id], "Te mando todo");
    const sent = await db.message.findMany({ where: { leadId: lead.id }, orderBy: { createdAt: "asc" } });
    expect(sent.map((m) => [m.author, m.userId, m.body, m.mediaName])).toEqual([
      ["USER", user.id, "Te mando todo", "foto.png"],
      ["USER", user.id, "", "masterplan.pdf"],
    ]);
    await expect(sendLibraryFiles(lead.id, user.id, ["no-existe"])).rejects.toThrow(/ya no está/);
    await expect(sendLibraryFiles(lead.id, user.id, [])).rejects.toThrow(/al menos un archivo/);
  });

  it("guarda el archivo subido; un video de más de 16 MB va como documento", async () => {
    const lead = await createLead({ name: "Ana", channel: "SIMULATOR" });
    const user = await executive("Pedro");
    await sendUploadedFile(lead.id, user.id, { url: blob(lead.id, "foto-abc.jpg"), fileName: "foto.jpg", mimeType: "image/jpeg", size: 2 * MB }, "Mira");
    await sendUploadedFile(lead.id, user.id, { url: blob(lead.id, "tour-abc.mp4"), fileName: "tour.mp4", mimeType: "video/mp4", size: 40 * MB });
    const sent = await db.message.findMany({ where: { leadId: lead.id }, orderBy: { createdAt: "asc" } });
    expect(sent.map((m) => [m.body, m.mediaType, m.mediaName])).toEqual([
      ["Mira", "image/jpeg", "foto.jpg"],
      ["", "application/octet-stream", "tour.mp4"],
    ]);
  });

  it("rechaza enlaces ajenos, fotos muy pesadas, audios y archivos sobre 100 MB", async () => {
    const lead = await createLead({ name: "Ana", channel: "SIMULATOR" });
    const other = await createLead({ name: "Beto", channel: "SIMULATOR" });
    const user = await executive("Pedro");
    const file = { fileName: "a.pdf", mimeType: "application/pdf", size: MB };
    await expect(sendUploadedFile(lead.id, user.id, { ...file, url: "https://evil.test/leads/x/archivos/a.pdf" })).rejects.toThrow(/No se pudo subir/);
    await expect(sendUploadedFile(lead.id, user.id, { ...file, url: blob(other.id, "a.pdf") })).rejects.toThrow(/No se pudo subir/);
    await expect(
      sendUploadedFile(lead.id, user.id, { url: blob(lead.id, "f.png"), fileName: "f.png", mimeType: "image/png", size: 8 * MB }),
    ).rejects.toThrow(/hasta 5 MB en imágenes/);
    await expect(
      sendUploadedFile(lead.id, user.id, { url: blob(lead.id, "n.mp3"), fileName: "n.mp3", mimeType: "audio/mpeg", size: MB }),
    ).rejects.toThrow(/nota de voz/);
    await expect(sendUploadedFile(lead.id, user.id, { ...file, url: blob(lead.id, "a.pdf"), size: 120 * MB })).rejects.toThrow(/hasta 100 MB/);
    expect(await db.message.count()).toBe(0);
  });

  it("la IA sabe qué archivo mandó el ejecutivo", async () => {
    const lead = await createLead({ name: "Ana", channel: "SIMULATOR" });
    const user = await executive("Pedro");
    await db.message.create({ data: { leadId: lead.id, author: "CONTACT", body: "¿Tienes el plano?" } });
    await sendUploadedFile(lead.id, user.id, { url: blob(lead.id, "plano.pdf"), fileName: "plano.pdf", mimeType: "application/pdf", size: MB }, "Aquí está");
    await db.message.create({ data: { leadId: lead.id, author: "CONTACT", body: "Gracias" } });
    const { clients, requests } = fakeAnthropic([{ stop_reason: "end_turn", content: [{ type: "text", text: "De nada" }] }]);
    await runAgent(lead.id, clients);
    expect(JSON.stringify(requests[0].messages)).toContain("Ejecutivo (Pedro): [envió el archivo plano.pdf]");
  });
});
