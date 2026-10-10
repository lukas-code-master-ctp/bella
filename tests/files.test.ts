import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createLead } from "@/lib/domain/leads";
import { setSetting } from "@/lib/settings";
import { runAgent } from "@/lib/ai/agent";
import type { AiConfig } from "@/lib/ai/config";
import type { AnthropicClient } from "@/lib/ai/providers";
import type { WhatsAppApi } from "@/lib/channels/whatsapp";
import type { MessengerApi } from "@/lib/channels/messenger";
import { deliverOutbound } from "@/lib/domain/channels";
import { addMediaFile } from "@/lib/domain/files";
import type { MediaStore } from "@/lib/media";
import { seedFunnel } from "./factories";

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
    await expect(addMediaFile({ title: "", description: "", file: pdf }, store)).rejects.toThrow(/nombre/);
    await expect(addMediaFile({ title: "Y", description: "" })).rejects.toThrow(/enlace/);
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
