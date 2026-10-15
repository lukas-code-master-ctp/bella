import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getSetting, setSetting } from "./settings";
import { currentCompanyId, DEFAULT_COMPANY_ID } from "./tenant";

/**
 * Credenciales de cada empresa (Meta, WhatsApp, IA, correo). Se cargan en Configuración →
 * Credenciales y se guardan cifradas en la configuración de la empresa ("credentials"). Solo la
 * empresa por defecto usa, si falta una, la variable de entorno del mismo nombre: así las
 * instalaciones que ya las tienen en Vercel siguen funcionando, y una empresa nueva nunca usa
 * las cuentas de otra. La clave de cifrado sale de SESSION_SECRET: si se cambia, hay que volver
 * a cargar las credenciales.
 */

export type CredentialGroup = "whatsapp" | "meta" | "ai" | "email";

type CredentialDef = {
  key: string;
  label: string;
  group: CredentialGroup;
  help: string;
  /** Secreto: no se muestra una vez guardado. Los ids sí se muestran. */
  secret: boolean;
};

export const CREDENTIALS = [
  {
    key: "WHATSAPP_TOKEN",
    label: "Token de WhatsApp",
    group: "whatsapp",
    secret: true,
    help: "Token permanente de un usuario del sistema (Business Manager → Usuarios del sistema).",
  },
  {
    key: "WHATSAPP_PHONE_NUMBER_ID",
    label: "Id del número de WhatsApp",
    group: "whatsapp",
    secret: false,
    help: "Identificador del número en la app de Meta (WhatsApp → Configuración de la API). No es el número de teléfono.",
  },
  {
    key: "WHATSAPP_BUSINESS_ACCOUNT_ID",
    label: "Id de la cuenta de WhatsApp Business",
    group: "whatsapp",
    secret: false,
    help: "Opcional: solo si el token tiene acceso a más de una cuenta de WhatsApp Business.",
  },
  {
    key: "META_APP_SECRET",
    label: "Clave secreta de la app de Meta",
    group: "meta",
    secret: true,
    help: "Configuración de la app → Básica. Firma los webhooks de WhatsApp, Instagram y Messenger.",
  },
  {
    key: "META_VERIFY_TOKEN",
    label: "Token de verificación del webhook",
    group: "meta",
    secret: true,
    help: "Un texto cualquiera que inventas; se pega igual en Meta al registrar el webhook.",
  },
  {
    key: "META_PAGE_ACCESS_TOKEN",
    label: "Token de la página de Facebook",
    group: "meta",
    secret: true,
    help: "Token permanente de la página, generado con un usuario del sistema. Sirve para Instagram y Messenger.",
  },
  {
    key: "META_PAGE_ID",
    label: "Id de la página de Facebook",
    group: "meta",
    secret: false,
    help: "La cuenta profesional de Instagram debe estar vinculada a esta página.",
  },
  {
    key: "META_IG_ACCOUNT_ID",
    label: "Id de la cuenta de Instagram",
    group: "meta",
    secret: false,
    help: "Opcional: la cuenta profesional de Instagram; filtra los webhooks de otras cuentas.",
  },
  {
    key: "META_ADS_TOKEN",
    label: "Token de anuncios (ads_read)",
    group: "meta",
    secret: true,
    help: "Opcional: muestra el nombre del anuncio y la campaña de cada lead, y en Métricas cuánto se gastó y cuánto vendió cada campaña. Sin él se prueba con el de WhatsApp o la página.",
  },
  {
    key: "META_AD_ACCOUNT_ID",
    label: "Cuentas publicitarias",
    group: "meta",
    secret: false,
    help: "Opcional: id de la cuenta publicitaria (act_123…), o varias separadas por coma. Si queda vacío se usan todas las que el token de anuncios puede ver.",
  },
  {
    key: "META_CAPI_TOKEN",
    label: "Token de la API de Conversiones",
    group: "meta",
    secret: true,
    help: "Para el Píxel de Meta: Administrador de eventos → el conjunto de datos → Configuración → Generar token.",
  },
  {
    key: "OPENROUTER_API_KEY",
    label: "Clave de OpenRouter",
    group: "ai",
    secret: true,
    help: "openrouter.ai → Keys. Con ella responde la asistente y se transcriben los audios.",
  },
  {
    key: "ANTHROPIC_API_KEY",
    label: "Clave de Anthropic",
    group: "ai",
    secret: true,
    help: "Opcional: solo si eliges Anthropic como proveedor en Asistente.",
  },
  {
    key: "RESEND_API_KEY",
    label: "Clave de Resend",
    group: "email",
    secret: true,
    help: "resend.com → API Keys. Envía el resumen semanal por correo.",
  },
] as const satisfies readonly CredentialDef[];

export type CredentialKey = (typeof CREDENTIALS)[number]["key"];

export const CREDENTIAL_KEYS: readonly CredentialKey[] = CREDENTIALS.map((c) => c.key);

const SETTING_KEY = "credentials";
const PREFIX = "v1:";

function cipherKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) throw new Error("SESSION_SECRET no está configurado (mínimo 16 caracteres).");
  return createHash("sha256").update(`bella-credentials:${secret}`).digest();
}

export function encryptValue(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", cipherKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return PREFIX + [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

/** Null si no se puede descifrar (otra SESSION_SECRET o valor dañado). */
export function decryptValue(stored: string): string | null {
  if (!stored.startsWith(PREFIX)) return null;
  try {
    const [iv, tag, data] = stored.slice(PREFIX.length).split(".").map((p) => Buffer.from(p, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", cipherKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// Las credenciales se leen varias veces por mensaje (token, número…): se guardan unos segundos
// en memoria. Al guardar se limpia; otras instancias del servidor las ven al vencer.
const TTL_MS = 10_000;
const cache = new Map<string, { at: number; values: Partial<Record<CredentialKey, string>> }>();

export function clearCredentialCache() {
  cache.clear();
}

async function stored(): Promise<Partial<Record<CredentialKey, string>>> {
  const companyId = await currentCompanyId();
  const hit = cache.get(companyId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.values;
  const raw = await getSetting<Record<string, unknown>>(SETTING_KEY, {});
  const values: Partial<Record<CredentialKey, string>> = {};
  for (const key of CREDENTIAL_KEYS) {
    const v = raw[key];
    const plain = typeof v === "string" ? decryptValue(v) : null;
    if (plain) values[key] = plain;
  }
  cache.set(companyId, { at: Date.now(), values });
  return values;
}

/** Variable de entorno de respaldo: solo para la empresa por defecto. */
async function fromEnv(key: CredentialKey): Promise<string | undefined> {
  return (await currentCompanyId()) === DEFAULT_COMPANY_ID ? process.env[key] || undefined : undefined;
}

/** Valor de una credencial: la guardada en la app o, en la empresa por defecto, la variable de entorno. */
export async function credential(key: CredentialKey): Promise<string | undefined> {
  return (await stored())[key] || (await fromEnv(key));
}

/** Todas las credenciales de una vez, para las funciones que necesitan varias. */
export async function credentials(): Promise<Record<CredentialKey, string | undefined>> {
  const saved = await stored();
  const entries = await Promise.all(CREDENTIAL_KEYS.map(async (k) => [k, saved[k] || (await fromEnv(k))] as const));
  return Object.fromEntries(entries) as Record<CredentialKey, string | undefined>;
}

export async function missingCredentials(keys: readonly CredentialKey[]): Promise<CredentialKey[]> {
  const all = await credentials();
  return keys.filter((k) => !all[k]);
}

export type CredentialStatus = {
  key: CredentialKey;
  /** Dónde está: guardada en la app, en las variables de entorno, o falta. */
  source: "app" | "env" | null;
  /** Valor visible para los ids; los secretos solo muestran los últimos 4 caracteres. */
  preview: string | null;
};

export async function credentialStatus(): Promise<CredentialStatus[]> {
  clearCredentialCache();
  const saved = await stored();
  const useEnv = (await currentCompanyId()) === DEFAULT_COMPANY_ID;
  return CREDENTIALS.map((c) => {
    const env = useEnv ? process.env[c.key] : undefined;
    const value = saved[c.key] || env || null;
    return {
      key: c.key,
      source: saved[c.key] ? "app" : env ? "env" : null,
      preview: !value ? null : c.secret ? `••••${value.slice(-4)}` : value,
    };
  });
}

/**
 * Guarda los valores que vienen con texto y borra los de `clear`; el resto queda igual. Así un
 * secreto ya guardado no se pierde por dejar su campo vacío (el formulario nunca lo muestra).
 */
export async function saveCredentials(values: Partial<Record<string, string>>, clear: readonly string[] = []) {
  const next = { ...(await getSetting<Record<string, string>>(SETTING_KEY, {})) };
  for (const key of CREDENTIAL_KEYS) {
    const v = values[key]?.trim();
    if (clear.includes(key)) delete next[key];
    else if (v) next[key] = encryptValue(v);
  }
  await setSetting(SETTING_KEY, next);
  clearCredentialCache();
}
