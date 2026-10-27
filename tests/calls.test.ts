import { beforeEach, describe, expect, it } from "vitest";
import { saveCredentials } from "@/lib/credentials";
import { db } from "@/lib/db";
import type { WaCall, WaWebhook } from "@/lib/channels/whatsapp";
import type { CallingApi } from "@/lib/channels/whatsapp-calls";
import { ChannelSendError } from "@/lib/channels/whatsapp";
import {
  answerCall,
  callsForUser,
  getCallSettings,
  hangUpCall,
  receiveWhatsAppCalls,
  rejectCall,
  saveCallSettings,
} from "@/lib/domain/calls";
import { setSetting } from "@/lib/settings";
import { executive, seedFunnel } from "./factories";

const PHONE_ID = "1234567890";
const FROM = "56911112222";

function webhook(calls: WaCall[], phoneId = PHONE_ID): WaWebhook {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "calls",
            value: { metadata: { phone_number_id: phoneId }, contacts: [{ wa_id: FROM, profile: { name: "Ana Pérez" } }], calls },
          },
        ],
      },
    ],
  };
}

const connect = (id = "wacid.1"): WaCall => ({
  id,
  from: FROM,
  to: "56900000000",
  event: "connect",
  direction: "USER_INITIATED",
  session: { sdp_type: "offer", sdp: "v=0 oferta" },
});

const terminate = (id = "wacid.1", extra: Partial<WaCall> = {}): WaCall => ({
  id,
  from: FROM,
  event: "terminate",
  direction: "USER_INITIATED",
  status: "COMPLETED",
  ...extra,
});

/** API de llamadas falsa: anota lo que se le pidió a Meta. */
function fakeApi(fail?: { setCalling?: string }) {
  const log: string[] = [];
  const api: CallingApi = {
    async setCalling(id, enabled) {
      if (fail?.setCalling && enabled) throw new ChannelSendError(fail.setCalling);
      log.push(`settings ${id} ${enabled}`);
    },
    async accept(id, callId, sdp) {
      log.push(`accept ${callId} ${sdp}`);
    },
    async reject(id, callId) {
      log.push(`reject ${callId}`);
    },
    async terminate(id, callId) {
      log.push(`terminate ${callId}`);
    },
  };
  return { api, log };
}

async function admin(name: string) {
  return db.user.create({ data: { name, email: `${name.toLowerCase()}@test.cl`, passwordHash: "x", role: "ADMIN" } });
}

beforeEach(async () => {
  await saveCredentials({ WHATSAPP_PHONE_NUMBER_ID: PHONE_ID });
  await seedFunnel();
});

describe("Llamadas de WhatsApp: configuración", () => {
  it("vienen apagadas y al activarlas prende el botón de llamar en Meta", async () => {
    expect(await getCallSettings()).toEqual({ enabled: false });
    const { api, log } = fakeApi();
    await saveCallSettings({ enabled: true }, api);
    expect(log).toEqual([`settings ${PHONE_ID} true`]);
    expect((await getCallSettings()).enabled).toBe(true);
  });

  it("si Meta no las activa, no se guardan y se explica el motivo", async () => {
    const { api } = fakeApi({ setCalling: "El número necesita un límite de 2.000." });
    await expect(saveCallSettings({ enabled: true }, api)).rejects.toThrow(/Meta no activó las llamadas: El número necesita/);
    expect((await getCallSettings()).enabled).toBe(false);
  });
});

describe("Llamadas de WhatsApp: entrantes", () => {
  it("apagadas en Beliapp, la llamada se rechaza sin crear nada", async () => {
    const { api, log } = fakeApi();
    await receiveWhatsAppCalls(webhook([connect()]), api);
    expect(log).toEqual(["reject wacid.1"]);
    expect(await db.call.count()).toBe(0);
    expect(await db.lead.count()).toBe(0);
  });

  it("suena a los administradores si el lead no tiene ejecutivo, una sola vez aunque Meta repita", async () => {
    await setSetting("calls", { enabled: true });
    const ana = await admin("Ana");
    const { api } = fakeApi();
    await receiveWhatsAppCalls(webhook([connect()]), api);
    await receiveWhatsAppCalls(webhook([connect()]), api);

    const call = await db.call.findFirstOrThrow({ include: { lead: { include: { contact: true } } } });
    expect(await db.call.count()).toBe(1);
    expect(call).toMatchObject({ status: "RINGING", sdpOffer: "v=0 oferta", phoneNumberId: PHONE_ID, ringUserIds: [ana.id] });
    expect(call.lead.contact.name).toBe("Ana Pérez");
    const notification = await db.notification.findFirstOrThrow();
    expect(notification).toMatchObject({ userId: ana.id, type: "CALL", body: "Te está llamando por WhatsApp" });

    const { ringing } = await callsForUser(ana.id);
    expect(ringing).toMatchObject([{ id: call.id, name: "Ana Pérez", sdpOffer: "v=0 oferta" }]);
    // Pasado el minuto, WhatsApp ya la cortó: deja de sonar.
    expect((await callsForUser(ana.id, null, new Date(Date.now() + 61_000))).ringing).toEqual([]);
  });

  it("suena al ejecutivo del lead y solo él la puede contestar; queda la nota con la duración", async () => {
    await setSetting("calls", { enabled: true });
    const boss = await admin("Jefa");
    const luis = await executive("Luis");
    const { api, log } = fakeApi();
    await receiveWhatsAppCalls(webhook([connect("wacid.0")]), api);
    await db.lead.updateMany({ data: { assigneeId: luis.id } });
    await db.call.deleteMany();

    await receiveWhatsAppCalls(webhook([connect()]), api);
    const call = await db.call.findFirstOrThrow({ where: { externalId: "wacid.1" } });
    expect(call.ringUserIds).toEqual([luis.id]);
    await expect(answerCall(call.id, boss.id, "v=0 respuesta", api)).rejects.toThrow(/no existe/);

    await answerCall(call.id, luis.id, "v=0 respuesta", api);
    expect(log).toContain("accept wacid.1 v=0 respuesta");
    expect((await db.call.findUniqueOrThrow({ where: { id: call.id } })).status).toBe("ANSWERED");
    expect((await callsForUser(luis.id, call.id)).currentStatus).toBe("ANSWERED");
    expect(await db.notification.count({ where: { userId: luis.id, type: "CALL", readAt: null } })).toBe(0);

    await hangUpCall(call.id, luis.id, api);
    expect(log).toContain("terminate wacid.1");
    await receiveWhatsAppCalls(webhook([terminate("wacid.1", { duration: 75 })]), api);
    await receiveWhatsAppCalls(webhook([terminate("wacid.1", { duration: 75 })]), api);

    expect(await db.call.findUniqueOrThrow({ where: { id: call.id } })).toMatchObject({ status: "ENDED", durationSec: 75 });
    expect((await callsForUser(luis.id, call.id)).currentStatus).toBe("ENDED");
    const events = await db.leadEvent.findMany({ where: { type: { startsWith: "CALL_" } } });
    expect(events).toMatchObject([{ type: "CALL_ENDED", userId: luis.id, data: { duration: 75, userName: "Luis" } }]);
  });

  it("si otra persona contestó primero, avisa que ya no está sonando", async () => {
    await setSetting("calls", { enabled: true });
    const ana = await admin("Ana");
    const bea = await admin("Bea");
    const { api } = fakeApi();
    await receiveWhatsAppCalls(webhook([connect()]), api);
    const call = await db.call.findFirstOrThrow();
    await answerCall(call.id, ana.id, "v=0 a", api);
    await expect(answerCall(call.id, bea.id, "v=0 b", api)).rejects.toThrow(/ya no está sonando/);
  });

  it("si nadie contesta, queda como perdida en el chat con su aviso", async () => {
    await setSetting("calls", { enabled: true });
    const ana = await admin("Ana");
    const { api } = fakeApi();
    await receiveWhatsAppCalls(webhook([connect()]), api);
    await db.notification.updateMany({ data: { readAt: new Date() } });
    await receiveWhatsAppCalls(webhook([terminate()]), api);

    expect((await db.call.findFirstOrThrow()).status).toBe("MISSED");
    expect(await db.leadEvent.findFirstOrThrow({ where: { type: "CALL_MISSED" } })).toBeTruthy();
    expect(await db.notification.findFirstOrThrow({ where: { readAt: null } })).toMatchObject({
      userId: ana.id,
      body: "Llamada perdida por WhatsApp",
    });
  });

  it("rechazar la corta en WhatsApp y anota quién la rechazó", async () => {
    await setSetting("calls", { enabled: true });
    const ana = await admin("Ana");
    const { api, log } = fakeApi();
    await receiveWhatsAppCalls(webhook([connect()]), api);
    const call = await db.call.findFirstOrThrow();
    await rejectCall(call.id, ana.id, api);
    await receiveWhatsAppCalls(webhook([terminate()]), api);

    expect(log).toContain("reject wacid.1");
    expect((await db.call.findFirstOrThrow()).status).toBe("REJECTED");
    const events = await db.leadEvent.findMany({ where: { type: "CALL_MISSED" } });
    expect(events).toMatchObject([{ data: { rejectedBy: "Ana" } }]);
  });

  it("ignora las llamadas de números que no son de la empresa", async () => {
    await setSetting("calls", { enabled: true });
    const { api, log } = fakeApi();
    await receiveWhatsAppCalls(webhook([connect()], "999"), api);
    expect(log).toEqual([]);
    expect(await db.call.count()).toBe(0);
  });
});
