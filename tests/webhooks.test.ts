import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { createLead, moveStage } from "@/lib/domain/leads";
import {
  authHeaderName,
  createWebhook,
  deliverPendingWebhooks,
  httpSender,
  isInternalIp,
  sendTestWebhook,
  setWebhookAuthHeader,
  type WebhookSender,
} from "@/lib/domain/webhooks";
import { seedFunnel } from "./factories";

// Sin DNS en las pruebas: un nombre que resuelve a la red interna.
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "10.1.2.3", family: 4 }] }));

/** URL donde no escucha nadie: el envío inmediato falla sin salir a internet. */
const LOCAL = "http://127.0.0.1:9/hook";

function fakeSender(status = 200) {
  const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
  const send: WebhookSender = async (url, { body, headers }) => {
    calls.push({ url, body, headers });
    return { status, text: status >= 400 ? "error interno" : "ok" };
  };
  return { send, calls };
}

describe("webhooks al entrar a una etapa", () => {
  it("envía la cabecera de autenticación guardada cifrada, y se puede cambiar o quitar", async () => {
    const [, calificado] = await seedFunnel();
    const hook = await createWebhook({ name: "Cierra", url: LOCAL, stageId: calificado.id, authHeader: "X-API-Key:  ctp_abc123 " });
    expect(hook.authHeader).not.toContain("ctp_abc123");
    expect(authHeaderName(hook.authHeader)).toBe("X-API-Key");

    const { send, calls } = fakeSender();
    await sendTestWebhook(hook.id, send);
    expect(calls[0].headers["X-API-Key"]).toBe("ctp_abc123");
    expect(calls[0].headers["Content-Type"]).toBe("application/json");

    await setWebhookAuthHeader(hook.id, "Authorization: Bearer xyz");
    await sendTestWebhook(hook.id, send);
    expect(calls[1].headers.Authorization).toBe("Bearer xyz");
    expect(calls[1].headers["X-API-Key"]).toBeUndefined();

    await setWebhookAuthHeader(hook.id, "");
    await sendTestWebhook(hook.id, send);
    expect(calls[2].headers.Authorization).toBeUndefined();

    await expect(setWebhookAuthHeader(hook.id, "sin dos puntos")).rejects.toThrow("Nombre: valor");
    await expect(setWebhookAuthHeader(hook.id, "Content-Type: text/plain")).rejects.toThrow("la pone Beliapp");
  });

  it("envía el lead firmado al entrar a la etapa, con la etapa anterior", async () => {
    const [nuevo, calificado] = await seedFunnel();
    const hook = await createWebhook({ name: "Calendario", url: LOCAL, stageId: calificado.id });
    const lead = await createLead({ name: "Ana", channel: "WHATSAPP", phone: "+56911112222", externalId: "56911112222" });
    // El envío inmediato falla (nadie escucha en LOCAL); se deja pendiente para enviarlo con el fake.
    await moveStage(lead.id, calificado.id, { actor: "AI" }, "Pidió visitar");
    await db.webhookDelivery.updateMany({ data: { status: "PENDING", attempts: 0 } });

    const { send, calls } = fakeSender();
    expect(await deliverPendingWebhooks(send)).toEqual({ sent: 1, failed: 0 });
    expect(calls).toHaveLength(1);
    const body = JSON.parse(calls[0].body);
    expect(body).toMatchObject({
      event: "lead.stage_entered",
      stage: { id: calificado.id, name: "Calificado" },
      previousStage: { id: nuevo.id, name: "Nuevo" },
      lead: { id: lead.id, contact: { name: "Ana", phone: "+56911112222", channel: "WHATSAPP" } },
    });
    const expected = `sha256=${createHmac("sha256", hook.secret).update(calls[0].body).digest("hex")}`;
    expect(calls[0].headers["X-Beliapp-Signature"]).toBe(expected);
    expect(calls[0].headers["X-Bella-Signature"]).toBe(expected); // nombre anterior, por compatibilidad
    expect(await db.webhookDelivery.findFirstOrThrow()).toMatchObject({ status: "SENT", httpStatus: 200 });

    // Ya enviado: no se repite.
    expect(await deliverPendingWebhooks(send)).toEqual({ sent: 0, failed: 0 });
  });

  it("no dispara en otras etapas, con el webhook pausado ni para leads del simulador", async () => {
    const [, calificado, cotizacion] = await seedFunnel();
    const hook = await createWebhook({ name: "X", url: LOCAL, stageId: cotizacion.id });
    const ana = await createLead({ name: "Ana", channel: "WHATSAPP", externalId: "1" });
    await moveStage(ana.id, calificado.id, { actor: "USER" });
    const sim = await createLead({ name: "Prueba", channel: "SIMULATOR" });
    await moveStage(sim.id, cotizacion.id, { actor: "USER" });
    await db.webhook.update({ where: { id: hook.id }, data: { active: false } });
    await moveStage(ana.id, cotizacion.id, { actor: "USER" });
    expect(await db.webhookDelivery.count()).toBe(0);
  });

  it("dispara al crear el lead si la primera etapa tiene webhook", async () => {
    const [nuevo] = await seedFunnel();
    await createWebhook({ name: "CRM externo", url: LOCAL, stageId: nuevo.id });
    await createLead({ name: "Ana", channel: "INSTAGRAM", externalId: "ig-1" });
    const d = await db.webhookDelivery.findFirstOrThrow();
    expect(d.payload).toMatchObject({ stage: { name: "Nuevo" }, previousStage: null });
  });

  it("reintenta cuando la URL falla y se rinde a los 5 intentos", async () => {
    const [, calificado] = await seedFunnel();
    await createWebhook({ name: "X", url: LOCAL, stageId: calificado.id });
    const lead = await createLead({ name: "Ana", channel: "WHATSAPP", externalId: "1" });
    await moveStage(lead.id, calificado.id, { actor: "USER" });
    await db.webhookDelivery.updateMany({ data: { status: "PENDING", attempts: 0 } });

    const { send } = fakeSender(500);
    for (let i = 0; i < 5; i++) expect(await deliverPendingWebhooks(send)).toEqual({ sent: 0, failed: 1 });
    expect(await deliverPendingWebhooks(send)).toEqual({ sent: 0, failed: 0 });
    expect(await db.webhookDelivery.findFirstOrThrow()).toMatchObject({
      status: "FAILED",
      attempts: 5,
      httpStatus: 500,
      error: "La URL respondió HTTP 500: error interno",
    });
  });

  it("valida la URL y prueba la integración con un lead de ejemplo", async () => {
    const [nuevo] = await seedFunnel();
    await expect(createWebhook({ name: "X", url: "http://example.com", stageId: nuevo.id })).rejects.toThrow("https://");
    await expect(createWebhook({ name: "X", url: "no es url", stageId: nuevo.id })).rejects.toThrow("no es válida");
    const hook = await createWebhook({ name: "X", url: "https://example.com/hook", stageId: nuevo.id });

    const ok = fakeSender(204);
    expect(await sendTestWebhook(hook.id, ok.send)).toEqual({ ok: true, message: "La URL respondió HTTP 204." });
    expect(JSON.parse(ok.calls[0].body)).toMatchObject({ test: true, stage: { name: "Nuevo" } });
    expect(await sendTestWebhook(hook.id, fakeSender(404).send)).toMatchObject({ ok: false });
    expect(await db.webhookDelivery.count()).toBe(0);
  });

  it("no deja apuntar a la red interna (SSRF)", async () => {
    const [nuevo] = await seedFunnel();
    for (const url of ["https://10.0.0.5/x", "https://169.254.169.254/latest", "https://[::1]/x", "https://0xa000001/x", "https://[::ffff:127.0.0.1]/x"]) {
      await expect(createWebhook({ name: "X", url, stageId: nuevo.id })).rejects.toThrow("red interna");
    }
    expect([isInternalIp("192.168.1.10"), isInternalIp("fe80::1"), isInternalIp("8.8.8.8"), isInternalIp("2606:4700::1111")]).toEqual([true, true, false, false]);
    // Un nombre que resuelve a la red interna se rechaza al enviar.
    await expect(httpSender("https://interno.example.com/x", { body: "{}", headers: {} })).rejects.toThrow("red interna");
    // localhost solo vale fuera de producción.
    vi.stubEnv("NODE_ENV", "production");
    await expect(createWebhook({ name: "X", url: "http://localhost:3000/x", stageId: nuevo.id })).rejects.toThrow("https://");
    await expect(createWebhook({ name: "X", url: "https://localhost/x", stageId: nuevo.id })).rejects.toThrow("red interna");
    vi.unstubAllEnvs();
  });
});
