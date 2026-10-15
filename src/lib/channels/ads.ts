import { credentials } from "../credentials";
import { GRAPH_VERSION } from "./whatsapp";

/**
 * API de Marketing de Meta: nombres del anuncio, conjunto y campaña a partir del id que llega
 * en el primer mensaje. Necesita un token con permiso ads_read sobre la cuenta publicitaria
 * (META_ADS_TOKEN); si no está, prueba con el de WhatsApp o el de la página, que a veces lo tienen.
 */
export type AdInfo = { adName?: string; adsetName?: string; campaignId?: string; campaignName?: string };

/** Lo que Beliapp necesita de la API de Marketing. Se reemplaza en pruebas. */
export type AdsApi = { lookup(adId: string): Promise<AdInfo | null> };

export async function adsToken(): Promise<string | undefined> {
  const c = await credentials();
  return c.META_ADS_TOKEN || c.WHATSAPP_TOKEN || c.META_PAGE_ACCESS_TOKEN || undefined;
}

export const marketingApi: AdsApi = {
  async lookup(adId) {
    const token = await adsToken();
    if (!token || !/^\d+$/.test(adId)) return null;
    try {
      const res = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${adId}?fields=name,adset{name},campaign{id,name}`,
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) },
      );
      if (!res.ok) return null;
      const ad = (await res.json()) as { name?: string; adset?: { name?: string }; campaign?: { id?: string; name?: string } };
      return { adName: ad.name, adsetName: ad.adset?.name, campaignId: ad.campaign?.id, campaignName: ad.campaign?.name };
    } catch {
      // Sin permiso o sin red: el lead queda con los datos que mandó Meta en el mensaje.
      return null;
    }
  },
};

/** Gasto de una campaña en el período, en la moneda de la cuenta publicitaria. */
export type CampaignSpend = { campaignId: string; campaignName: string; spend: number };

/** Respuesta de /insights a nivel de campaña. */
export function parseInsights(json: unknown): CampaignSpend[] {
  const data = (json as { data?: { campaign_id?: string; campaign_name?: string; spend?: string }[] })?.data ?? [];
  return data
    .filter((r) => r.campaign_id && r.campaign_name)
    .map((r) => ({ campaignId: r.campaign_id!, campaignName: r.campaign_name!, spend: Math.round(Number(r.spend) || 0) }));
}

/**
 * Cuánto gastó cada campaña entre dos fechas (AAAA-MM-DD, ambas incluidas) en las cuentas de
 * META_AD_ACCOUNT_ID, o en todas las que vea el token si no hay. `null` si no hay token o Meta no
 * responde: Métricas se muestra igual, sin gasto.
 */
export async function campaignSpend(since: string, until: string): Promise<CampaignSpend[] | null> {
  const token = await adsToken();
  if (!token) return null;
  const get = async (path: string) => {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Meta ${res.status}`);
    return res.json();
  };
  try {
    const configured = ((await credentials()).META_AD_ACCOUNT_ID ?? "")
      .split(",")
      .map((s) => s.trim().replace(/^act_/, ""))
      .filter((s) => /^\d+$/.test(s));
    const accounts = configured.length
      ? configured
      : (((await get("me/adaccounts?fields=account_id&limit=50")) as { data?: { account_id?: string }[] }).data ?? [])
          .map((a) => a.account_id ?? "")
          .filter(Boolean);
    if (!accounts.length) return null;
    const range = encodeURIComponent(JSON.stringify({ since, until }));
    const pages = await Promise.all(
      accounts.map((id) =>
        get(`act_${id}/insights?level=campaign&fields=campaign_id,campaign_name,spend&time_range=${range}&limit=500`).then(parseInsights),
      ),
    );
    return pages.flat();
  } catch {
    // Sin permiso ads_read, cuenta equivocada o sin red.
    return null;
  }
}

/**
 * Pausa una campaña en Meta (status PAUSED). Necesita que el token de anuncios tenga el permiso
 * ads_management, no solo ads_read. Devuelve null si Meta la pausó o el motivo si no.
 */
export async function pauseMetaCampaign(campaignId: string): Promise<string | null> {
  const token = await adsToken();
  if (!token) return "Falta el token de anuncios en Configuración → Credenciales.";
  if (!/^\d+$/.test(campaignId)) return "La campaña no tiene un id de Meta válido.";
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${campaignId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ status: "PAUSED" }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return null;
    const json = (await res.json().catch(() => null)) as { error?: { message?: string; code?: number } } | null;
    // 200 y 10 son errores de permiso: el token tiene ads_read pero no ads_management.
    if (json?.error?.code === 200 || json?.error?.code === 10) {
      return "El token de anuncios no tiene permiso para modificar campañas (ads_management).";
    }
    return `Meta no pausó la campaña: ${json?.error?.message ?? `error ${res.status}`}`;
  } catch {
    return "No se pudo conectar con Meta. Inténtalo de nuevo.";
  }
}
