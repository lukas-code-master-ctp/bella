import { randomInt } from "node:crypto";
import type { LeadSource } from "@prisma/client";
import { db } from "../db";
import { getSetting, setSetting } from "../settings";
import { marketingApi, type AdsApi } from "../channels/ads";

/**
 * Origen de cada lead, para saber de qué anuncio o campaña viene:
 * - Anuncios de Meta (clic a WhatsApp, Instagram o Messenger): Meta manda el id del anuncio en el
 *   primer mensaje; con la API de Marketing se completan los nombres de la campaña y el conjunto.
 * - Landings: el botón de WhatsApp apunta a /wa?utm_source=…; Bella guarda los UTM, redirige a
 *   WhatsApp con un código en el mensaje prellenado y, cuando el mensaje llega, los une al lead.
 */

export type AttributionSettings = {
  /** Número de WhatsApp al que lleva el enlace /wa, solo dígitos con código de país (ej. 56912345678). */
  whatsappNumber: string;
  /** Mensaje prellenado si la landing no manda `text`. */
  defaultText: string;
};

export const DEFAULT_ATTRIBUTION: AttributionSettings = {
  whatsappNumber: "",
  defaultText: "Hola, quiero más información",
};

export async function getAttributionSettings(): Promise<AttributionSettings> {
  return { ...DEFAULT_ATTRIBUTION, ...(await getSetting<Partial<AttributionSettings>>("attribution", {})) };
}

export async function saveAttributionSettings(s: Partial<AttributionSettings>) {
  const next = { ...(await getAttributionSettings()), ...s };
  next.whatsappNumber = next.whatsappNumber.replace(/\D/g, "");
  await setSetting("attribution", next);
}

// --- Anuncios de Meta ------------------------------------------------------------------------

/** Datos del anuncio o publicación que trae el primer mensaje (`referral` en los webhooks de Meta). */
export type AdReferral = {
  adId?: string;
  adType?: string;
  headline?: string;
  body?: string;
  url?: string;
  ctwaClid?: string;
};

const clip = (s: string | undefined | null, max = 500) => {
  const t = s?.trim();
  return t ? t.slice(0, max) : null;
};

/**
 * Guarda el anuncio por el que llegó el lead, si aún no tiene origen (cuenta el primer contacto),
 * y busca los nombres de la campaña. Nunca lanza: el mensaje del cliente importa más.
 */
export async function attachAdSource(leadId: string, ad: AdReferral, ads: AdsApi = marketingApi): Promise<boolean> {
  if (!ad.adId && !ad.url && !ad.ctwaClid) return false;
  try {
    if (await db.leadSource.findUnique({ where: { leadId } })) return false;
    const info = ad.adId && ad.adType !== "post" ? await ads.lookup(ad.adId) : null;
    await db.leadSource.create({
      data: {
        leadId,
        kind: "AD",
        adId: clip(ad.adId, 64),
        adType: clip(ad.adType, 20),
        adHeadline: clip(ad.headline, 200),
        adBody: clip(ad.body),
        adUrl: clip(ad.url, 1000),
        ctwaClid: clip(ad.ctwaClid, 1000),
        adName: clip(info?.adName, 200),
        adsetName: clip(info?.adsetName, 200),
        campaignId: clip(info?.campaignId, 64),
        campaignName: clip(info?.campaignName, 200),
      },
    });
    return true;
  } catch (err) {
    // Otro webhook simultáneo ya guardó el origen, o Meta mandó datos raros.
    console.error(`[origen] lead ${leadId}:`, err);
    return false;
  }
}

// --- Enlaces desde landings ------------------------------------------------------------------

export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;

export type Utm = {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  landingUrl?: string | null;
};

/** UTM de los parámetros de una URL (vacíos se ignoran). */
export function utmFromParams(params: URLSearchParams): Utm {
  const get = (k: string) => clip(params.get(k), 200);
  return {
    utmSource: get("utm_source"),
    utmMedium: get("utm_medium"),
    utmCampaign: get("utm_campaign"),
    utmContent: get("utm_content"),
    utmTerm: get("utm_term"),
  };
}

const hasUtm = (u: Utm) => Boolean(u.utmSource || u.utmMedium || u.utmCampaign || u.utmContent || u.utmTerm);

// Sin 0/O ni 1/I/L para que nadie los confunda si reescribe el mensaje.
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from({ length: 6 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join("");

/** Guarda los UTM de un clic y devuelve su código; null si el enlace no traía UTM. */
export async function createSourceLink(utm: Utm): Promise<string | null> {
  if (!hasUtm(utm)) return null;
  const data = { ...utm, landingUrl: clip(utm.landingUrl, 1000) };
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    try {
      await db.sourceLink.create({ data: { code, ...data } });
      return code;
    } catch {
      // Código repetido: se prueba otro.
    }
  }
  return null;
}

/** Enlace a WhatsApp con el mensaje prellenado y, si hay, el código de origen al final. */
export function whatsappUrl(number: string, text: string, code: string | null): string {
  const message = code ? `${text}\n\n(ref. ${code})` : text;
  return `https://wa.me/${number.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
}

const REF = /\(?\bref\.?\s*:?\s*([A-HJ-NP-Z2-9]{6})\b\)?/i;

/** Código de origen dentro del mensaje del cliente y el texto sin él. */
export function extractRefCode(body: string): { code: string; text: string } | null {
  const m = REF.exec(body);
  if (!m) return null;
  const text = (body.slice(0, m.index) + body.slice(m.index + m[0].length)).replace(/[ \t]{2,}/g, " ").trim();
  return { code: m[1].toUpperCase(), text };
}

/** Une los UTM del código al lead, si el código existe y el lead aún no tiene origen. */
export async function attachLinkSource(leadId: string, code: string): Promise<boolean> {
  const link = await db.sourceLink.findUnique({ where: { code } });
  if (!link) return false;
  try {
    if (await db.leadSource.findUnique({ where: { leadId } })) return false;
    await db.leadSource.create({
      data: {
        leadId,
        kind: "LINK",
        utmSource: link.utmSource,
        utmMedium: link.utmMedium,
        utmCampaign: link.utmCampaign,
        utmContent: link.utmContent,
        utmTerm: link.utmTerm,
        landingUrl: link.landingUrl,
      },
    });
    await db.sourceLink.updateMany({ where: { code, leadId: null }, data: { leadId } });
    return true;
  } catch (err) {
    console.error(`[origen] lead ${leadId}, código ${code}:`, err);
    return false;
  }
}

/**
 * Texto del mensaje del cliente sin el código de origen, que se une al lead. Si el mensaje era
 * solo el código, queda tal cual para no guardar un mensaje vacío.
 */
export async function takeRefCode(leadId: string, body: string): Promise<string> {
  const ref = extractRefCode(body);
  if (!ref || !(await attachLinkSource(leadId, ref.code))) return body;
  return ref.text || body;
}

// --- Para mostrar y agrupar ----------------------------------------------------------------

/** Campaña con que se agrupa el lead en las métricas: la de Meta o el utm_campaign. */
export function campaignOf(s: Pick<LeadSource, "campaignName" | "utmCampaign" | "adHeadline" | "adId"> | null): string | null {
  return s?.campaignName ?? s?.utmCampaign ?? s?.adHeadline ?? (s?.adId ? `Anuncio ${s.adId}` : null);
}

/** Resumen corto del origen, para la tarjeta del lead. */
export function sourceLabel(s: LeadSource | null): string {
  if (!s) return "Directo";
  if (s.kind === "AD") return s.adType === "post" ? "Publicación de Meta" : "Anuncio de Meta";
  return s.utmSource ? `Enlace · ${s.utmSource}` : "Enlace con UTM";
}
