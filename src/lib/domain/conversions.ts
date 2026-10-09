import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { getSetting, setSetting } from "../settings";
import { GRAPH_VERSION } from "../channels/whatsapp";

/**
 * API de Conversiones de Meta: le cuenta a Meta qué leads se calificaron y cuáles compraron, para
 * que optimice los anuncios hacia personas parecidas. Viene apagada y se enciende en
 * Configuración → Píxel de Meta.
 *
 * - Lead que llegó por un anuncio de clic a WhatsApp: se envía como mensajería de negocio con el
 *   ctwa_clid, así Meta lo atribuye al anuncio exacto.
 * - Lead de un anuncio de Instagram o Messenger: mensajería de negocio con el id de la persona.
 * - Cualquier otro: evento del CRM con el teléfono y el correo cifrados (SHA-256).
 *
 * Los eventos se guardan en la misma transacción que el cambio de etapa o el cierre y se envían
 * después; si Meta falla, el cron los reintenta.
 */

export type PixelSettings = {
  enabled: boolean;
  /** Id del píxel o dataset en el Administrador de eventos. */
  datasetId: string;
  /** Etapa que cuenta como "lead calificado"; vacía para no enviar ese evento. */
  qualifiedStageId: string;
  /** Código de prueba del Administrador de eventos (pestaña Probar eventos); vacío en producción. */
  testEventCode: string;
};

export const DEFAULT_PIXEL: PixelSettings = { enabled: false, datasetId: "", qualifiedStageId: "", testEventCode: "" };

export async function getPixelSettings(): Promise<PixelSettings> {
  return { ...DEFAULT_PIXEL, ...(await getSetting<Partial<PixelSettings>>("pixel", {})) };
}

export async function savePixelSettings(s: Partial<PixelSettings>) {
  const next = { ...(await getPixelSettings()), ...s };
  next.datasetId = next.datasetId.replace(/\D/g, "");
  await setSetting("pixel", next);
}

export function pixelToken(): string | undefined {
  return process.env.META_CAPI_TOKEN || undefined;
}

export type ConversionKind = "QUALIFIED" | "PURCHASE";

type Tx = Prisma.TransactionClient;

/** Deja pendiente el evento si la API está encendida. Uno por lead y tipo: reabrir y volver a ganar no lo repite. */
async function queueTx(tx: Tx, leadId: string, kind: ConversionKind, value: number | null = null) {
  const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId }, select: { contact: { select: { channel: true } } } });
  if (lead.contact.channel === "SIMULATOR") return;
  await tx.conversionEvent.createMany({ data: [{ leadId, kind, value }], skipDuplicates: true });
}

/** Al entrar a una etapa: si es la de "lead calificado", deja el evento pendiente. */
export async function queueQualifiedTx(tx: Tx, leadId: string, stageId: string) {
  const s = await getPixelSettings();
  if (s.enabled && s.datasetId && s.qualifiedStageId === stageId) await queueTx(tx, leadId, "QUALIFIED");
}

/** Al ganar el lead: deja pendiente la venta con su monto. */
export async function queuePurchaseTx(tx: Tx, leadId: string, amount: number | null) {
  const s = await getPixelSettings();
  if (s.enabled && s.datasetId) await queueTx(tx, leadId, "PURCHASE", amount);
}

// --- Envío -----------------------------------------------------------------------------------

export type CapiEvent = Record<string, unknown>;

/** Lo que Bella necesita de la API de Conversiones. Se reemplaza en pruebas. */
export type ConversionsApi = { send(datasetId: string, events: CapiEvent[], testEventCode?: string): Promise<void> };

export const conversionsApi: ConversionsApi = {
  async send(datasetId, events, testEventCode) {
    const token = pixelToken();
    if (!token) throw new Error("Falta META_CAPI_TOKEN en las variables de entorno.");
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${datasetId}/events`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ data: events, ...(testEventCode ? { test_event_code: testEventCode } : {}) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; error_user_msg?: string } };
      throw new Error(`Meta rechazó el evento: ${json.error?.error_user_msg || json.error?.message || `HTTP ${res.status}`}`);
    }
  },
};

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const MAX_ATTEMPTS = 5;

type EventWithLead = Prisma.ConversionEventGetPayload<{
  include: { lead: { include: { contact: true; source: true } } };
}>;

/** Arma el evento como lo pide Meta, o null si no hay cómo identificar al cliente. */
export function buildEvent(e: EventWithLead): CapiEvent | null {
  const { contact, source } = e.lead;
  const base = {
    event_id: e.id,
    event_time: Math.floor(e.createdAt.getTime() / 1000),
    ...(e.kind === "PURCHASE" ? { custom_data: { currency: "CLP", value: e.value ?? 0 } } : {}),
  };
  const phone = contact.phone?.replace(/\D/g, "");
  const hashed = {
    ...(phone ? { ph: [sha256(phone)] } : {}),
    ...(contact.email ? { em: [sha256(contact.email.trim().toLowerCase())] } : {}),
  };

  if (source?.ctwaClid && contact.channel === "WHATSAPP") {
    const waba = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
    return {
      ...base,
      event_name: e.kind === "PURCHASE" ? "Purchase" : "QualifiedLead",
      action_source: "business_messaging",
      messaging_channel: "whatsapp",
      user_data: { ctwa_clid: source.ctwaClid, ...(waba ? { whatsapp_business_account_id: waba } : {}), ...hashed },
    };
  }
  if (source?.kind === "AD" && contact.externalId && (contact.channel === "INSTAGRAM" || contact.channel === "FACEBOOK")) {
    const ig = contact.channel === "INSTAGRAM";
    const owner = ig ? process.env.META_IG_ACCOUNT_ID : process.env.META_PAGE_ID;
    if (owner) {
      return {
        ...base,
        event_name: e.kind === "PURCHASE" ? "Purchase" : "QualifiedLead",
        action_source: "business_messaging",
        messaging_channel: ig ? "instagram" : "messenger",
        user_data: ig
          ? { ig_account_id: owner, ig_sid: contact.externalId, ...hashed }
          : { page_id: owner, page_scoped_user_id: contact.externalId, ...hashed },
      };
    }
  }
  if (!hashed.ph && !hashed.em) return null;
  return {
    ...base,
    event_name: e.kind === "PURCHASE" ? "Purchase" : "Lead",
    action_source: "system_generated",
    user_data: { ...hashed, external_id: [sha256(contact.id)] },
    custom_data: { ...(base.custom_data ?? {}), lead_event_source: "Bella" },
  };
}

/**
 * Envía los eventos pendientes (y reintenta los fallidos). Nunca lanza: un evento que no sale no
 * debe romper el cambio de etapa ni el cierre que lo originó.
 */
export async function deliverPendingConversions(api: ConversionsApi = conversionsApi): Promise<{ sent: number; failed: number }> {
  const result = { sent: 0, failed: 0 };
  try {
    const settings = await getPixelSettings();
    if (!settings.enabled || !settings.datasetId) return result;
    // Sin token los eventos esperan pendientes, sin gastar reintentos.
    if (api === conversionsApi && !pixelToken()) return result;
    const pending = await db.conversionEvent.findMany({
      where: { OR: [{ status: "PENDING" }, { status: "FAILED", attempts: { lt: MAX_ATTEMPTS } }] },
      include: { lead: { include: { contact: true, source: true } } },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    for (const e of pending) {
      // Se toma antes de enviarlo, así dos llamadas simultáneas no lo mandan dos veces.
      const claimed = await db.conversionEvent.updateMany({
        where: { id: e.id, status: e.status, attempts: e.attempts },
        data: { status: "SENDING", attempts: { increment: 1 } },
      });
      if (!claimed.count) continue;
      const event = buildEvent(e);
      if (!event) {
        await db.conversionEvent.update({
          where: { id: e.id },
          data: { status: "SKIPPED", error: "El lead no tiene teléfono, correo ni anuncio con que Meta pueda reconocerlo." },
        });
        continue;
      }
      try {
        await api.send(settings.datasetId, [event], settings.testEventCode || undefined);
        await db.conversionEvent.update({ where: { id: e.id }, data: { status: "SENT", sentAt: new Date(), error: null } });
        result.sent++;
      } catch (err) {
        const message = err instanceof Error ? err.message : "No se pudo enviar a Meta.";
        await db.conversionEvent.update({ where: { id: e.id }, data: { status: "FAILED", error: message.slice(0, 500) } });
        result.failed++;
      }
    }
  } catch (err) {
    console.error("[conversiones]", err);
  }
  return result;
}
