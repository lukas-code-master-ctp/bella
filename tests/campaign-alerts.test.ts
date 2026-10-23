import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { closeLead, createLead } from "@/lib/domain/leads";
import { setSetting } from "@/lib/settings";
import type { AiConfig } from "@/lib/ai/config";
import type { ChatClient } from "@/lib/ai/providers";
import { parseAdvice } from "@/lib/ai/campaign-advice";
import {
  activeCampaignAlerts,
  getCampaignAlertSettings,
  pauseAlertCampaign,
  runCampaignAlerts,
  saveCampaignAlertSettings,
} from "@/lib/domain/campaign-alerts";
import { seedFunnel } from "./factories";

const ADVICE = JSON.stringify({
  diagnostico: "Llegan personas buscando arriendo, no compra.",
  causas: ["5 de 6 preguntaron por arriendo mensual"],
  mejoras: ["Aclarar en el anuncio que es venta", "  Excluir intereses de arriendo "],
  apagar: true,
  motivoApagar: "El público no compra.",
});

function fakeOpenRouter(content: string) {
  const requests: { messages: { role: string; content: string }[] }[] = [];
  const client: ChatClient = {
    async complete(body) {
      requests.push(structuredClone(body) as (typeof requests)[number]);
      return { model: "x", choices: [{ finish_reason: "stop", message: { role: "assistant", content } }] };
    },
  };
  return { clients: { openrouter: client }, requests };
}

let n = 0;
async function campaignLead(campaignName: string, status: "OPEN" | "WON" | "LOST", reason?: string, said?: string) {
  const lead = await createLead({ name: `Cliente Pérez ${++n}`, channel: "WHATSAPP", externalId: `x${n}` });
  await db.leadSource.create({
    data: { leadId: lead.id, kind: "AD", adId: "111", adHeadline: "Parcelas desde $9 millones", campaignId: "2385", campaignName },
  });
  if (said) await db.message.create({ data: { leadId: lead.id, author: "CONTACT", body: said } });
  if (status !== "OPEN") await closeLead(lead.id, status, { actor: "SYSTEM" }, { lostReason: reason ?? "No califica" });
  return lead;
}

describe("alertas de campañas", () => {
  it("alerta la campaña que pierde casi todo, pide la recomendación y se cierra al mejorar", async () => {
    await setSetting<AiConfig>("ai", { provider: "openrouter", model: "grande", effort: "high", summaryModel: "chico" });
    await seedFunnel();
    await saveCampaignAlertSettings({ minLeads: 5, lostPct: 70 });
    for (let i = 0; i < 5; i++) await campaignLead("Arriendo", "LOST", i < 3 ? "Busca arriendo" : "Sin presupuesto", "¿Cuánto es el arriendo mensual?");
    await campaignLead("Arriendo", "OPEN");
    // Buena campaña y una con pocos leads: no alertan.
    for (let i = 0; i < 5; i++) await campaignLead("Buena", i < 2 ? "WON" : "OPEN");
    for (let i = 0; i < 3; i++) await campaignLead("Chica", "LOST");

    const { clients, requests } = fakeOpenRouter("```json\n" + ADVICE + "\n```");
    expect(await runCampaignAlerts(new Date(), clients)).toEqual({ enabled: true, opened: 1, resolved: 0 });

    const [alert] = await activeCampaignAlerts();
    expect(alert).toMatchObject({ campaign: "Arriendo", campaignId: "2385", leads: 6, lost: 5, won: 0 });
    expect(alert.reasons).toEqual([
      { reason: "Busca arriendo", count: 3 },
      { reason: "Sin presupuesto", count: 2 },
    ]);
    expect(alert.advice).toMatchObject({ shouldPause: true, improvements: ["Aclarar en el anuncio que es venta", "Excluir intereses de arriendo"] });
    expect(alert.adviceModel).toBe("chico");
    const input = requests[0].messages[1].content;
    expect(input).toContain("Campaña: Arriendo.");
    expect(input).toContain("Parcelas desde $9 millones");
    expect(input).toContain("¿Cuánto es el arriendo mensual?");
    expect(input).not.toContain("Pérez"); // sin nombres de clientes

    // Otra pasada: sigue en alerta, sin volver a llamar a la IA ni avisar.
    expect(await runCampaignAlerts(new Date(), clients)).toMatchObject({ opened: 0, resolved: 0 });
    expect(requests).toHaveLength(1);

    // Llegan leads buenos: baja del umbral y la alerta se cierra.
    for (let i = 0; i < 4; i++) await campaignLead("Arriendo", "WON");
    expect(await runCampaignAlerts(new Date(), clients)).toMatchObject({ opened: 0, resolved: 1 });
    expect(await activeCampaignAlerts()).toHaveLength(0);
  });

  it("no revisa si está apagada y la alerta queda aunque la IA falle", async () => {
    await seedFunnel();
    await saveCampaignAlertSettings({ enabled: false, minLeads: 3 });
    for (let i = 0; i < 3; i++) await campaignLead("Mala", "LOST");
    expect(await runCampaignAlerts()).toMatchObject({ enabled: false });

    await saveCampaignAlertSettings({ enabled: true });
    const { clients } = fakeOpenRouter("no es json");
    expect(await runCampaignAlerts(new Date(), clients)).toMatchObject({ opened: 1 });
    const [alert] = await activeCampaignAlerts();
    expect(alert.advice).toBeNull();
  });

  it("pausa en Meta solo con el botón encendido y una campaña con id", async () => {
    await seedFunnel();
    await saveCampaignAlertSettings({ minLeads: 3 });
    expect((await getCampaignAlertSettings()).allowPause).toBe(false);
    for (let i = 0; i < 3; i++) await campaignLead("Mala", "LOST");
    await runCampaignAlerts(new Date(), fakeOpenRouter(ADVICE).clients);
    const [alert] = await activeCampaignAlerts();
    const user = await db.user.create({ data: { name: "Admin", email: "a@test.cl", passwordHash: "x", role: "ADMIN" } });
    const paused: string[] = [];
    const fake = async (id: string) => {
      paused.push(id);
      return null;
    };

    expect(await pauseAlertCampaign(alert.id, user.id, fake)).toMatch(/apagado/);
    expect(paused).toEqual([]);

    await saveCampaignAlertSettings({ allowPause: true });
    expect(await pauseAlertCampaign(alert.id, user.id, async () => "sin ads_management")).toBe("sin ads_management");
    expect(await pauseAlertCampaign(alert.id, user.id, fake)).toBeNull();
    expect(paused).toEqual(["2385"]);
    expect(await db.campaignAlert.findUnique({ where: { id: alert.id } })).toMatchObject({ pausedById: user.id, pausedAt: expect.any(Date) });
  });

  it("limita los umbrales a valores razonables", async () => {
    await saveCampaignAlertSettings({ minLeads: 0, lostPct: 500, days: Number.NaN });
    expect(await getCampaignAlertSettings()).toMatchObject({ minLeads: 3, lostPct: 100, days: 14 });
  });

  it("descarta respuestas que no son JSON", () => {
    expect(parseAdvice("hola")).toBeNull();
    expect(parseAdvice(JSON.stringify({ diagnostico: "x", apagar: false, motivoApagar: "no" }))).toEqual({
      diagnosis: "x",
      causes: [],
      improvements: [],
      shouldPause: false,
      pauseReason: "",
    });
  });
});
