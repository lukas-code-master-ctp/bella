import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { aiChannels, deliverOutbound, receiveWeb, saveChannelSettings } from "@/lib/domain/channels";
import { DomainError } from "@/lib/domain/leads";
import { originAllowed, parseDomains, saveWebWidgetSettings, getWebWidgetSettings, webConversation } from "@/lib/domain/web-widget";
import { seedFunnel } from "./factories";

const VISITOR = "a1b2c3d4e5f6a7b8c9d0";
let n = 0;
const send = (body: string, extra: Partial<Parameters<typeof receiveWeb>[0]> = {}) =>
  receiveWeb({ visitorId: VISITOR, clientId: `c${++n}`, body, ...extra });

describe("widget web", () => {
  beforeEach(async () => {
    await seedFunnel();
  });

  it("crea el lead del canal Web, completa el contacto y guarda el origen con UTM", async () => {
    const res = await send("Hola, quiero info", {
      name: "Ana",
      phone: "+56 9 1234 5678",
      pageUrl: "https://miempresa.cl/oferta?utm_source=google&utm_campaign=verano",
    });
    expect(res?.answer).toBe(false);
    const lead = await db.lead.findUniqueOrThrow({ where: { id: res!.leadId }, include: { contact: true, source: true } });
    expect(lead.contact).toMatchObject({ channel: "WEB", externalId: VISITOR, name: "Ana", phone: "+56912345678" });
    expect(lead.aiEnabled).toBe(false);
    expect(lead.source).toMatchObject({ kind: "LINK", utmSource: "google", utmCampaign: "verano", landingUrl: "https://miempresa.cl/oferta" });

    const again = await send("¿Precio?");
    expect(again?.leadId).toBe(res!.leadId);
  });

  it("no guarda dos veces el mismo mensaje reenviado", async () => {
    await receiveWeb({ visitorId: VISITOR, clientId: "x", body: "Hola" });
    await receiveWeb({ visitorId: VISITOR, clientId: "x", body: "Hola" });
    expect(await db.message.count({ where: { author: "CONTACT" } })).toBe(1);
  });

  it("pide responder a la IA solo si está encendida para el widget", async () => {
    await saveChannelSettings({ webAi: true });
    expect(await aiChannels()).toContain("WEB");
    const res = await send("Hola");
    expect(res?.answer).toBe(true);
  });

  it("frena a quien escribe demasiado rápido", async () => {
    for (let i = 0; i < 10; i++) await send(`m${i}`);
    await expect(send("otro")).rejects.toBeInstanceOf(DomainError);
  });

  it("el visitante ve las respuestas, que quedan leídas, y el envío no sale a ningún lado", async () => {
    const res = await send("Hola");
    await db.message.create({ data: { leadId: res!.leadId, author: "AI", body: "¡Hola! ¿En qué te ayudo?" } });
    expect(await deliverOutbound(res!.leadId)).toBeNull();
    const conv = await webConversation(VISITOR);
    expect(conv.map((m) => [m.from, m.body])).toEqual([
      ["visitor", "Hola"],
      ["agent", "¡Hola! ¿En qué te ayudo?"],
    ]);
    const reply = await db.message.findFirstOrThrow({ where: { author: "AI" } });
    expect(reply.deliveryStatus).toBe("READ");
    expect(await webConversation(VISITOR, new Date(conv[1].at))).toEqual([]);
  });

  it("limita los dominios y normaliza la configuración", async () => {
    expect(parseDomains("https://www.MiEmpresa.cl/x, tienda.cl\nbasura")).toEqual(["www.miempresa.cl", "tienda.cl"]);
    expect(originAllowed({ allowedDomains: "" }, null)).toBe(true);
    expect(originAllowed({ allowedDomains: "tienda.cl" }, "https://shop.tienda.cl")).toBe(true);
    expect(originAllowed({ allowedDomains: "tienda.cl" }, "https://tienda.cl.malo.com")).toBe(false);
    expect(originAllowed({ allowedDomains: "tienda.cl" }, null)).toBe(false);
    await saveWebWidgetSettings({ enabled: true, color: "rojo", title: " ", allowedDomains: "https://tienda.cl/" });
    expect(await getWebWidgetSettings()).toMatchObject({ enabled: true, color: "#2c8040", title: "Escríbenos", allowedDomains: "tienda.cl" });
  });
});
