import { randomBytes, randomInt } from "node:crypto";
import { GRAPH_VERSION } from "../channels/whatsapp";
import { companyUrls } from "../company-urls";
import { credential, saveCredentials } from "../credentials";
import { currentCompanyId } from "../tenant";
import { DomainError } from "./leads";

/**
 * Registro integrado de WhatsApp (Embedded Signup): el cliente toca "Conectar con Meta", inicia
 * sesión en la ventana de Meta, elige o crea su número y Bella queda conectada sin crear una app
 * ni copiar tokens. Usa la app de Meta de la plataforma (la de Bella como proveedor tecnológico),
 * configurada en Vercel; sin ella el botón no aparece y se conecta como antes, con Credenciales:
 * - META_PLATFORM_APP_ID y META_PLATFORM_APP_SECRET: la app de Bella.
 * - META_PLATFORM_CONFIG_ID: la configuración de "Inicio de sesión con Facebook para empresas"
 *   de esa app, con el tipo de registro integrado de WhatsApp.
 */
export function platformApp() {
  const appId = process.env.META_PLATFORM_APP_ID;
  const secret = process.env.META_PLATFORM_APP_SECRET;
  const configId = process.env.META_PLATFORM_CONFIG_ID;
  return appId && secret && configId ? { appId, secret, configId } : null;
}

/** Lo que el navegador necesita para abrir la ventana de Meta (sin la clave secreta). */
export function signupConfig() {
  const app = platformApp();
  return app ? { appId: app.appId, configId: app.configId, graphVersion: GRAPH_VERSION } : null;
}

/** Llamadas a Meta del registro. Se reemplaza en pruebas. */
export type SignupApi = {
  /** Cambia el código de la ventana de Meta por el token de la empresa. */
  exchangeCode(code: string): Promise<string>;
  /** Activa el número para la API, con un PIN nuevo de verificación en dos pasos. */
  register(phoneNumberId: string, token: string, pin: string): Promise<void>;
  /** Suscribe la app a la cuenta de WhatsApp, con los webhooks hacia la URL de esta empresa. */
  subscribe(wabaId: string, token: string, callbackUrl: string, verifyToken: string): Promise<void>;
};

async function graph(path: string, init: RequestInit, what: string): Promise<unknown> {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`, init);
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok || json.error) throw new DomainError(`Meta rechazó ${what}: ${json.error?.message ?? `HTTP ${res.status}`}`);
  return json;
}

const post = (token: string, body: Record<string, unknown>): RequestInit => ({
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const metaSignupApi: SignupApi = {
  async exchangeCode(code) {
    const app = platformApp();
    if (!app) throw new DomainError("El registro con Meta no está habilitado en esta instalación.");
    const query = new URLSearchParams({ client_id: app.appId, client_secret: app.secret, code });
    const json = (await graph(`oauth/access_token?${query}`, {}, "el código de la conexión")) as { access_token?: string };
    if (!json.access_token) throw new DomainError("Meta no entregó el token de la empresa. Vuelve a intentarlo.");
    return json.access_token;
  },
  async register(phoneNumberId, token, pin) {
    await graph(`${phoneNumberId}/register`, post(token, { messaging_product: "whatsapp", pin }), "el registro del número");
  },
  async subscribe(wabaId, token, callbackUrl, verifyToken) {
    await graph(
      `${wabaId}/subscribed_apps`,
      post(token, { override_callback_uri: callbackUrl, verify_token: verifyToken }),
      "la suscripción de los webhooks",
    );
  },
};

const META_ID = /^\d{5,25}$/;

/**
 * Termina la conexión con lo que devolvió la ventana de Meta: guarda el token y los ids en las
 * credenciales de la empresa, activa el número y apunta sus webhooks a la URL de la empresa. La
 * clave secreta y el token de verificación que ya tenga la empresa (de su propia app, para
 * Instagram o Messenger) se mantienen; el webhook de WhatsApp acepta también la firma de la app
 * de la plataforma.
 */
export async function completeWhatsAppSignup(
  input: { code: string; wabaId: string; phoneNumberId: string; origin: string },
  api: SignupApi = metaSignupApi,
) {
  const app = platformApp();
  if (!app) throw new DomainError("El registro con Meta no está habilitado en esta instalación.");
  if (!input.code || !META_ID.test(input.wabaId) || !META_ID.test(input.phoneNumberId)) {
    throw new DomainError("Meta no devolvió los datos del número. Vuelve a intentarlo.");
  }
  const token = await api.exchangeCode(input.code);
  const verifyToken = (await credential("META_VERIFY_TOKEN")) || randomBytes(24).toString("hex");
  await saveCredentials({
    WHATSAPP_TOKEN: token,
    WHATSAPP_PHONE_NUMBER_ID: input.phoneNumberId,
    WHATSAPP_BUSINESS_ACCOUNT_ID: input.wabaId,
    META_VERIFY_TOKEN: verifyToken,
    ...((await credential("META_APP_SECRET")) ? {} : { META_APP_SECRET: app.secret }),
  });
  await api.register(input.phoneNumberId, token, String(randomInt(0, 1_000_000)).padStart(6, "0"));
  // Al suscribir, Meta verifica la URL con el token de verificación: ya tiene que estar guardado.
  const urls = companyUrls(input.origin, await currentCompanyId());
  await api.subscribe(input.wabaId, token, urls.whatsappWebhook, verifyToken);
}
