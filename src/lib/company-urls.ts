import { DEFAULT_COMPANY_ID } from "./tenant";

/**
 * Direcciones públicas de una empresa: las que se registran en Meta y se ponen en las landings.
 * La empresa por defecto conserva las de siempre; las demás llevan su id.
 */
export function companyUrls(origin: string, companyId: string) {
  const own = companyId !== DEFAULT_COMPANY_ID;
  const hook = (channel: string) => `${origin}/api/webhooks/${channel}${own ? `/${companyId}` : ""}`;
  const query = own ? `?c=${encodeURIComponent(companyId)}` : "";
  return {
    whatsappWebhook: hook("whatsapp"),
    metaWebhook: hook("meta"),
    dataDeletionCallback: `${hook("meta")}/data-deletion`,
    privacy: `${origin}/privacidad${query}`,
    dataDeletion: `${origin}/eliminacion-de-datos${query}`,
    /** Enlace /wa; los UTM se agregan con `withParams`. */
    wa: `${origin}/wa${query}`,
  };
}

/** Agrega parámetros a una URL que puede o no tener ya `?`. */
export function withParams(url: string, params: string) {
  return `${url}${url.includes("?") ? "&" : "?"}${params}`;
}
