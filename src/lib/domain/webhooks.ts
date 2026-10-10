import { createHmac, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { DomainError } from "./leads";

/**
 * Webhooks salientes: cuando un lead entra a una etapa, Bella envía un POST con los datos del lead
 * a las URLs configuradas para esa etapa (Configuración → Webhooks). Sirve para avisar a otro
 * sistema, por ejemplo agendar la visita en el calendario del cliente o crear la ficha en su ERP.
 *
 * El cuerpo se arma en la misma transacción que el cambio de etapa (así refleja el lead en ese
 * momento) y se envía después; si la URL falla, el cron lo reintenta hasta MAX_ATTEMPTS veces.
 * Cada envío va firmado: X-Bella-Signature = "sha256=" + HMAC-SHA256(clave del webhook, cuerpo).
 */

type Tx = Prisma.TransactionClient;

export const WEBHOOK_EVENT = "lead.stage_entered";
const MAX_ATTEMPTS = 5;

export function newWebhookSecret() {
  return `whsec_${randomBytes(24).toString("hex")}`;
}

/** Normaliza la URL o lanza DomainError: solo https (o http a localhost, para probar). */
export function normalizeWebhookUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new DomainError("La URL del webhook no es válida.");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new DomainError("La URL del webhook debe empezar con https://");
  }
  return url.toString();
}

export async function createWebhook(input: { name: string; url: string; stageId: string }) {
  const name = input.name.trim();
  if (!name) throw new DomainError("Ponle un nombre al webhook.");
  await db.stage.findUniqueOrThrow({ where: { id: input.stageId } });
  return db.webhook.create({
    data: { name, url: normalizeWebhookUrl(input.url), stageId: input.stageId, secret: newWebhookSecret() },
  });
}

const APP_URL =
  process.env.APP_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");

/** Datos del lead que viajan en el webhook. */
async function leadPayloadTx(tx: Tx, leadId: string) {
  const lead = await tx.lead.findUniqueOrThrow({
    where: { id: leadId },
    include: {
      stage: true,
      assignee: { select: { name: true, email: true } },
      source: true,
      contact: {
        include: {
          tags: { include: { tag: true } },
          fields: { include: { field: true }, orderBy: { field: { position: "asc" } } },
        },
      },
    },
  });
  const { contact, source } = lead;
  return {
    id: lead.id,
    url: APP_URL ? `${APP_URL}/leads/${lead.id}` : null,
    status: lead.status,
    amount: lead.amount,
    createdAt: lead.createdAt.toISOString(),
    summary: lead.aiSummary,
    score: lead.score,
    assignee: lead.assignee ? { name: lead.assignee.name, email: lead.assignee.email } : null,
    contact: {
      id: contact.id,
      name: contact.name,
      phone: contact.phone,
      email: contact.email,
      channel: contact.channel,
      tags: contact.tags.map((t) => ({ category: t.tag.category, name: t.tag.name })),
      fields: Object.fromEntries(contact.fields.map((f) => [f.field.name, f.value])),
    },
    source: source
      ? {
          kind: source.kind,
          campaign: source.campaignName ?? source.utmCampaign,
          adName: source.adName,
          utmSource: source.utmSource,
          utmMedium: source.utmMedium,
          utmCampaign: source.utmCampaign,
          utmContent: source.utmContent,
          utmTerm: source.utmTerm,
        }
      : null,
  };
}

/**
 * Al entrar a una etapa: deja pendiente un envío por cada webhook activo de esa etapa. Los leads
 * del simulador no disparan webhooks (son pruebas).
 */
export async function queueStageWebhooksTx(
  tx: Tx,
  leadId: string,
  stage: { id: string; name: string },
  from: { id: string; name: string } | null,
) {
  const hooks = await tx.webhook.findMany({ where: { stageId: stage.id, active: true }, select: { id: true } });
  if (!hooks.length) return;
  const lead = await leadPayloadTx(tx, leadId);
  if (lead.contact.channel === "SIMULATOR") return;
  const payload = {
    event: WEBHOOK_EVENT,
    occurredAt: new Date().toISOString(),
    stage: { id: stage.id, name: stage.name },
    previousStage: from,
    lead,
  };
  await tx.webhookDelivery.createMany({
    data: hooks.map((h) => ({ webhookId: h.id, leadId, payload: { ...payload, webhookId: h.id } })),
  });
}

// --- Envío -----------------------------------------------------------------------------------

export function signWebhook(secret: string, body: string) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** Cómo sale el POST. Se reemplaza en pruebas. */
export type WebhookSender = (
  url: string,
  init: { body: string; headers: Record<string, string> },
) => Promise<{ status: number; text: string }>;

export const httpSender: WebhookSender = async (url, { body, headers }) => {
  const res = await fetch(url, {
    method: "POST",
    headers,
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(8_000),
  });
  return { status: res.status, text: await res.text().catch(() => "") };
};

type PostResult = { ok: true; httpStatus: number } | { ok: false; httpStatus: number | null; error: string };

async function post(
  send: WebhookSender,
  webhook: { url: string; secret: string },
  deliveryId: string,
  payload: unknown,
): Promise<PostResult> {
  const body = JSON.stringify(payload);
  try {
    const res = await send(webhook.url, {
      body,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Bella-Webhooks/1",
        "X-Bella-Event": WEBHOOK_EVENT,
        "X-Bella-Delivery": deliveryId,
        "X-Bella-Signature": signWebhook(webhook.secret, body),
      },
    });
    if (res.status >= 200 && res.status < 300) return { ok: true, httpStatus: res.status };
    const detail = res.text.replace(/\s+/g, " ").trim().slice(0, 200);
    return { ok: false, httpStatus: res.status, error: `La URL respondió HTTP ${res.status}${detail ? `: ${detail}` : ""}` };
  } catch (err) {
    const timeout = err instanceof Error && err.name === "TimeoutError";
    const message = timeout ? "La URL no respondió a tiempo (8 segundos)." : err instanceof Error ? err.message : "";
    return { ok: false, httpStatus: null, error: `No se pudo conectar con la URL. ${message}`.trim() };
  }
}

/**
 * Envía un lead de ejemplo (sin guardarlo) para que el admin pruebe la integración desde
 * Configuración. Lleva "test": true para que el otro sistema pueda ignorarlo.
 */
export async function sendTestWebhook(webhookId: string, send: WebhookSender = httpSender): Promise<{ ok: boolean; message: string }> {
  const webhook = await db.webhook.findUniqueOrThrow({ where: { id: webhookId }, include: { stage: true } });
  const payload = {
    event: WEBHOOK_EVENT,
    test: true,
    occurredAt: new Date().toISOString(),
    webhookId,
    stage: { id: webhook.stage.id, name: webhook.stage.name },
    previousStage: null,
    lead: {
      id: "lead_de_prueba",
      url: null,
      status: "OPEN",
      amount: null,
      createdAt: new Date().toISOString(),
      summary: "Lead de prueba enviado desde Configuración → Webhooks.",
      score: null,
      assignee: null,
      contact: {
        id: "contacto_de_prueba",
        name: "Cliente de prueba",
        phone: "+56900000000",
        email: "prueba@example.com",
        channel: "WHATSAPP",
        tags: [],
        fields: {},
      },
      source: null,
    },
  };
  const res = await post(send, webhook, `test_${Date.now()}`, payload);
  return res.ok ? { ok: true, message: `La URL respondió HTTP ${res.httpStatus}.` } : { ok: false, message: res.error };
}

/**
 * Envía los webhooks pendientes y reintenta los fallidos. Nunca lanza: un webhook que falla no
 * debe romper el cambio de etapa que lo originó.
 */
export async function deliverPendingWebhooks(send: WebhookSender = httpSender): Promise<{ sent: number; failed: number }> {
  const result = { sent: 0, failed: 0 };
  try {
    const pending = await db.webhookDelivery.findMany({
      where: {
        OR: [{ status: "PENDING" }, { status: "FAILED", attempts: { lt: MAX_ATTEMPTS } }],
        webhook: { active: true },
      },
      include: { webhook: true },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    for (const d of pending) {
      // Se toma antes de enviarlo, así dos llamadas simultáneas no lo mandan dos veces.
      const claimed = await db.webhookDelivery.updateMany({
        where: { id: d.id, status: d.status, attempts: d.attempts },
        data: { status: "SENDING", attempts: { increment: 1 } },
      });
      if (!claimed.count) continue;
      const res = await post(send, d.webhook, d.id, d.payload);
      await db.webhookDelivery.update({
        where: { id: d.id },
        data: res.ok
          ? { status: "SENT", sentAt: new Date(), httpStatus: res.httpStatus, error: null }
          : { status: "FAILED", httpStatus: res.httpStatus, error: res.error.slice(0, 500) },
      });
      if (res.ok) result.sent++;
      else result.failed++;
    }
  } catch (err) {
    console.error("[webhooks]", err);
  }
  return result;
}
