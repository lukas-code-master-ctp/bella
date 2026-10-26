import { createHmac, timingSafeEqual } from "node:crypto";
import type { EmailSuppressionReason } from "@prisma/client";
import { db } from "../db";
import { APP_URL } from "../email";
import { currentCompanyId, withCompany } from "../tenant";
import { companyForSender } from "./email-domains";

/**
 * Direcciones a las que una empresa ya no manda envíos masivos por correo: las que se dieron de
 * baja con el enlace del correo, las que rebotaron de forma definitiva y las que lo marcaron
 * como spam. Cada correo masivo lleva su enlace de baja y las cabeceras List-Unsubscribe (Gmail
 * y Yahoo las exigen, y la ley pide una forma simple de dejar de recibir publicidad).
 */

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function isEmailSuppressed(email: string) {
  return Boolean(await db.emailSuppression.findUnique({ where: { companyId_email: { companyId: await currentCompanyId(), email: normalizeEmail(email) } } }));
}

/** De una lista, las direcciones que no se pueden usar. */
export async function suppressedAmong(emails: string[]): Promise<Set<string>> {
  if (!emails.length) return new Set();
  const rows = await db.emailSuppression.findMany({ where: { email: { in: emails.map(normalizeEmail) } }, select: { email: true } });
  return new Set(rows.map((r) => r.email));
}

/**
 * Deja la dirección fuera de los envíos. Un rebote o una queja reemplazan a una baja (pesan
 * más: no se puede volver a incluir), pero una baja no reemplaza a un rebote ni a una queja.
 */
export async function suppressEmail(email: string, reason: EmailSuppressionReason, detail = "") {
  const companyId = await currentCompanyId();
  const address = normalizeEmail(email);
  const existing = await db.emailSuppression.findUnique({ where: { companyId_email: { companyId, email: address } } });
  if (existing && (existing.reason !== "UNSUBSCRIBED" || reason === "UNSUBSCRIBED")) return existing;
  return db.emailSuppression.upsert({
    where: { companyId_email: { companyId, email: address } },
    create: { email: address, reason, detail: detail.slice(0, 500) },
    update: { reason, detail: detail.slice(0, 500), createdAt: new Date() },
  });
}

/**
 * Vuelve a incluir una dirección que se dio de baja (la persona lo pidió). Las que rebotaron o
 * marcaron spam no se pueden volver a incluir: insistir daña la reputación del dominio.
 */
export async function resubscribeEmail(email: string) {
  const { count } = await db.emailSuppression.deleteMany({ where: { email: normalizeEmail(email), reason: "UNSUBSCRIBED" } });
  return count > 0;
}

export async function listEmailSuppressions(take = 200) {
  const [rows, counts] = await Promise.all([
    db.emailSuppression.findMany({ orderBy: { createdAt: "desc" }, take }),
    db.emailSuppression.groupBy({ by: ["reason"], _count: true }),
  ]);
  const total = Object.fromEntries(counts.map((c) => [c.reason, c._count])) as Partial<Record<EmailSuppressionReason, number>>;
  return { rows, total };
}

// Enlace de baja

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET no está configurado (mínimo 16 caracteres).");
  return s;
}

const sign = (payload: string) => createHmac("sha256", secret()).update(`unsubscribe:${payload}`).digest("base64url");

/** Token del enlace de baja: empresa y dirección, firmados. No vence. */
export function unsubscribeToken(companyId: string, email: string) {
  const payload = Buffer.from(JSON.stringify({ c: companyId, e: normalizeEmail(email) })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readUnsubscribeToken(token: string): { companyId: string; email: string } | null {
  const [payload, sig] = token.split(".", 2);
  if (!payload || !sig) return null;
  const given = Buffer.from(sig, "base64url");
  const expected = Buffer.from(sign(payload), "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const { c, e } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { c?: unknown; e?: unknown };
    return typeof c === "string" && typeof e === "string" ? { companyId: c, email: e } : null;
  } catch {
    return null;
  }
}

/**
 * Enlace de baja para el pie del correo y cabeceras para el botón "Anular suscripción" de
 * Gmail, Yahoo y otros (RFC 8058: un POST a la URL da de baja sin más pasos).
 */
export async function unsubscribeLinks(email: string) {
  const token = unsubscribeToken(await currentCompanyId(), email);
  return {
    url: `${APP_URL}/baja/${token}`,
    headers: {
      "List-Unsubscribe": `<${APP_URL}/api/baja/${token}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}

// Webhook de Resend

/**
 * Revisa la firma de un webhook de Resend (lo firma Svix): HMAC-SHA256 de "id.timestamp.cuerpo"
 * con el secreto "whsec_…" de la configuración del webhook en Resend. Rechaza avisos de más de
 * 5 minutos para que no se puedan reenviar.
 */
export function verifyResendSignature(
  rawBody: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  webhookSecret: string | undefined,
  now = Date.now(),
) {
  if (!webhookSecret || !headers.id || !headers.timestamp || !headers.signature) return false;
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 5 * 60) return false;
  const key = Buffer.from(webhookSecret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${headers.id}.${headers.timestamp}.${rawBody}`).digest();
  return headers.signature.split(" ").some((part) => {
    const [version, sig] = part.split(",", 2);
    if (version !== "v1" || !sig) return false;
    const given = Buffer.from(sig, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

type ResendEvent = {
  type?: string;
  created_at?: string;
  data?: {
    email_id?: string;
    from?: string;
    to?: string[] | string;
    bounce?: { type?: string; subType?: string; message?: string };
  };
};

const EVENT_FIELD = {
  "email.delivered": "deliveredAt",
  "email.opened": "openedAt",
  "email.clicked": "clickedAt",
  "email.bounced": "bouncedAt",
  "email.complained": "complainedAt",
} as const;

/** Guarda en el destinatario de un envío por correo lo que pasó con su correo (la primera vez). */
async function recordRecipientEvent(type: keyof typeof EVENT_FIELD, resendId: string, at: Date) {
  const field = EVENT_FIELD[type];
  await db.emailRecipient.updateMany({ where: { resendId, [field]: null }, data: { [field]: at } });
  // Si lo abrió o hizo clic, le llegó, aunque el aviso de entrega aún no aparezca.
  if (field === "openedAt" || field === "clickedAt") {
    await db.emailRecipient.updateMany({ where: { resendId, deliveredAt: null }, data: { deliveredAt: at } });
  }
}

/**
 * Aplica un aviso de Resend en la empresa dueña del remitente: marca entregas, aperturas, clics,
 * rebotes y quejas en el envío, y un rebote definitivo o una queja de spam dejan la dirección
 * fuera de los próximos envíos. Los rebotes temporales (buzón lleno) no. Devuelve cuántas
 * direcciones quedaron fuera.
 */
export async function handleResendEvent(event: ResendEvent, expectedCompanyId?: string): Promise<number> {
  const { type, data } = event;
  if (!type || !data?.from || !(type in EVENT_FIELD)) return 0;
  const companyId = await companyForSender(data.from);
  // El webhook de una empresa solo toca los datos de esa empresa.
  if (!companyId || (expectedCompanyId && companyId !== expectedCompanyId)) return 0;
  const permanentBounce = type === "email.bounced" && data.bounce?.type === "Permanent";
  const at = event.created_at ? new Date(event.created_at) : new Date();
  const to = (Array.isArray(data.to) ? data.to : data.to ? [data.to] : []).map((t) => t.match(/<([^>]+)>/)?.[1] ?? t);
  return withCompany(companyId, async () => {
    if (data.email_id && (type !== "email.bounced" || permanentBounce)) {
      await recordRecipientEvent(type as keyof typeof EVENT_FIELD, data.email_id, isNaN(at.getTime()) ? new Date() : at);
    }
    if (!permanentBounce && type !== "email.complained") return 0;
    const reason: EmailSuppressionReason = permanentBounce ? "BOUNCED" : "COMPLAINED";
    const detail = permanentBounce ? [data.bounce?.subType, data.bounce?.message].filter(Boolean).join(": ") : "";
    for (const address of to) await suppressEmail(address, reason, detail);
    return to.length;
  });
}
