import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { closeLead, createLead, moveStage, reopenLead } from "@/lib/domain/leads";
import {
  deliverPendingConversions,
  savePixelSettings,
  type CapiEvent,
  type ConversionsApi,
} from "@/lib/domain/conversions";
import { seedFunnel } from "./factories";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function fakeApi(fail = false) {
  const sent: { dataset: string; event: CapiEvent; test?: string }[] = [];
  const api: ConversionsApi = {
    send: async (dataset, events, test) => {
      if (fail) throw new Error("Meta rechazó el evento: token inválido");
      for (const event of events) sent.push({ dataset, event, test });
    },
  };
  return { api, sent };
}

afterEach(() => {
  delete process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
});

describe("API de Conversiones", () => {
  it("apagada por defecto: no deja eventos pendientes", async () => {
    const [, calificado] = await seedFunnel();
    const lead = await createLead({ name: "Ana", channel: "WHATSAPP", phone: "+56911112222", externalId: "56911112222" });
    await moveStage(lead.id, calificado.id, { actor: "AI" });
    await closeLead(lead.id, "WON", { actor: "USER" }, { amount: 1000 });
    expect(await db.conversionEvent.count()).toBe(0);
  });

  it("envía lead calificado y venta: mensajería de negocio con ctwa_clid si vino de un anuncio a WhatsApp", async () => {
    const [, calificado] = await seedFunnel();
    process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = "waba-1";
    await savePixelSettings({ enabled: true, datasetId: "px 123", qualifiedStageId: calificado.id, testEventCode: "TEST1" });
    const lead = await createLead({ name: "Ana", channel: "WHATSAPP", phone: "+56 9 1111 2222", externalId: "56911112222" });
    await db.leadSource.create({ data: { leadId: lead.id, kind: "AD", adId: "1", ctwaClid: "clid-abc" } });

    await moveStage(lead.id, calificado.id, { actor: "AI" });
    await closeLead(lead.id, "WON", { actor: "USER" }, { amount: 39_000_000 });
    // Reabrir y volver a ganar no repite la venta.
    await reopenLead(lead.id, { actor: "USER" });
    await closeLead(lead.id, "WON", { actor: "USER" }, { amount: 39_000_000 });

    const { api, sent } = fakeApi();
    expect(await deliverPendingConversions(api)).toEqual({ sent: 2, failed: 0 });
    expect(sent.map((s) => [s.dataset, s.test, s.event.event_name, s.event.action_source])).toEqual([
      ["123", "TEST1", "QualifiedLead", "business_messaging"],
      ["123", "TEST1", "Purchase", "business_messaging"],
    ]);
    expect(sent[1].event).toMatchObject({
      messaging_channel: "whatsapp",
      user_data: { ctwa_clid: "clid-abc", whatsapp_business_account_id: "waba-1", ph: [sha("56911112222")] },
      custom_data: { currency: "CLP", value: 39_000_000 },
    });
    expect(await db.conversionEvent.count({ where: { status: "SENT" } })).toBe(2);
    expect(await deliverPendingConversions(api)).toEqual({ sent: 0, failed: 0 });
  });

  it("sin anuncio usa el evento del CRM con datos cifrados; sin teléfono ni correo lo omite", async () => {
    await seedFunnel();
    await savePixelSettings({ enabled: true, datasetId: "123" });
    const withEmail = await createLead({ name: "Beto", channel: "INSTAGRAM", externalId: "ig-1" });
    await db.contact.update({ where: { id: withEmail.contactId }, data: { email: " Beto@Mail.cl " } });
    const anonymous = await createLead({ name: "Caro", channel: "INSTAGRAM", externalId: "ig-2" });
    await closeLead(withEmail.id, "WON", { actor: "USER" }, { amount: null });
    await closeLead(anonymous.id, "WON", { actor: "USER" }, { amount: null });

    const { api, sent } = fakeApi();
    await deliverPendingConversions(api);
    expect(sent).toHaveLength(1);
    expect(sent[0].event).toMatchObject({
      event_name: "Purchase",
      action_source: "system_generated",
      user_data: { em: [sha("beto@mail.cl")], external_id: [sha(withEmail.contactId)] },
      custom_data: { currency: "CLP", value: 0, lead_event_source: "Bella" },
    });
    expect((await db.conversionEvent.findFirstOrThrow({ where: { leadId: anonymous.id } })).status).toBe("SKIPPED");
  });

  it("si Meta falla queda el motivo y se reintenta", async () => {
    await seedFunnel();
    await savePixelSettings({ enabled: true, datasetId: "123" });
    const lead = await createLead({ name: "Ana", channel: "WHATSAPP", phone: "+56911112222", externalId: "56911112222" });
    await closeLead(lead.id, "WON", { actor: "USER" }, { amount: 5 });

    expect(await deliverPendingConversions(fakeApi(true).api)).toEqual({ sent: 0, failed: 1 });
    const failed = await db.conversionEvent.findFirstOrThrow();
    expect([failed.status, failed.error, failed.attempts]).toEqual(["FAILED", "Meta rechazó el evento: token inválido", 1]);

    expect(await deliverPendingConversions(fakeApi().api)).toEqual({ sent: 1, failed: 0 });
  });
});
