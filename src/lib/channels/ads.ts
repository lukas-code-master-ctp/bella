import { credentials } from "../credentials";
import { GRAPH_VERSION } from "./whatsapp";

/**
 * API de Marketing de Meta: nombres del anuncio, conjunto y campaña a partir del id que llega
 * en el primer mensaje. Necesita un token con permiso ads_read sobre la cuenta publicitaria
 * (META_ADS_TOKEN); si no está, prueba con el de WhatsApp o el de la página, que a veces lo tienen.
 */
export type AdInfo = { adName?: string; adsetName?: string; campaignId?: string; campaignName?: string };

/** Lo que Bella necesita de la API de Marketing. Se reemplaza en pruebas. */
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
