import { credentialStatus, saveCredentials, type CredentialKey } from "../credentials";
import { db } from "../db";
import { removeEmailDomain, type EmailDomainsApi } from "./email-domains";
import { DomainError } from "./leads";
import { saveWebWidgetSettings } from "./web-widget";

/** Canales que se pueden quitar desde Configuración → Canales. */
export type DisconnectableChannel = "WHATSAPP" | "INSTAGRAM" | "FACEBOOK" | "WEB" | "EMAIL";

// La clave secreta y el token de verificación de la app de Meta se dejan: los comparten WhatsApp,
// Instagram y Messenger, y sirven para volver a conectar sin cargarlos de nuevo.
const WHATSAPP_KEYS: CredentialKey[] = ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_BUSINESS_ACCOUNT_ID"];
// Instagram y Messenger usan la misma página de Facebook: se desconectan juntos.
const PAGE_KEYS: CredentialKey[] = ["META_PAGE_ACCESS_TOKEN", "META_PAGE_ID", "META_IG_ACCOUNT_ID"];

/** Borra las credenciales de un canal. Las que vienen de variables de entorno no se pueden borrar desde la app. */
async function clearCredentials(keys: CredentialKey[]) {
  const fromEnv = (await credentialStatus()).filter((c) => keys.includes(c.key) && c.source === "env");
  if (fromEnv.length) {
    throw new DomainError(
      `Este canal está conectado con variables de entorno del servidor (${fromEnv.map((c) => c.key).join(", ")}). Hay que quitarlas en Vercel.`,
    );
  }
  await saveCredentials({}, keys);
}

/**
 * Quita un canal conectado: deja de recibir y enviar mensajes por él. Los leads y sus
 * conversaciones se conservan, y el canal se puede volver a conectar desde "Agregar canal".
 */
export async function disconnectChannel(kind: DisconnectableChannel, deps: { emailApi?: EmailDomainsApi } = {}) {
  switch (kind) {
    case "WHATSAPP":
      await clearCredentials(WHATSAPP_KEYS);
      // Los números extra dependen del mismo token: también se quitan.
      await db.contact.updateMany({ where: { waPhoneNumberId: { not: null } }, data: { waPhoneNumberId: null } });
      await db.whatsAppNumber.deleteMany({});
      return;
    case "INSTAGRAM":
    case "FACEBOOK":
      await clearCredentials(PAGE_KEYS);
      // Sin estas filas, los avisos de la app de Beliapp para esa página ya no llegan a la empresa.
      await db.metaAccount.deleteMany({});
      return;
    case "WEB":
      await saveWebWidgetSettings({ enabled: false });
      return;
    case "EMAIL":
      await removeEmailDomain(deps.emailApi);
      return;
  }
}
