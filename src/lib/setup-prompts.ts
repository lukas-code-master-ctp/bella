/**
 * Prompt para "Conectar Meta con Claude": el admin lo copia, lo pega en Claude (con acceso a su
 * navegador) y Claude conecta Meta por él. Sirve para cualquier empresa, también una que parte
 * desde cero (sin portafolio de Meta, número de WhatsApp ni píxel): cada paso dice qué revisar y
 * qué crear si no existe. Se arma con lo que ya está configurado, así Claude salta lo que está
 * listo. Nunca incluye valores secretos, solo qué credenciales faltan.
 */

import { companyUrls } from "./company-urls";
import { CREDENTIALS } from "./credentials";
import { DEFAULT_COMPANY_ID } from "./tenant";
import { DEFAULT_ASSISTANT } from "./settings";

export type SetupStatus = {
  /** Dirección de esta instalación, ej. https://crm.empresa.cl */
  origin: string;
  /** Empresa a configurar; cambia las URLs de los webhooks y de las páginas legales. */
  companyId?: string;
  /** Credenciales que faltan (claves de CREDENTIALS, ej. WHATSAPP_TOKEN). */
  missingEnv: string[];
  whatsappNumber: string;
  pixel: { enabled: boolean; datasetId: string; qualifiedStage: string | null };
  legal: { legalName: string; contactEmail: string };
  /** Nombre de la empresa guardado en la asistente (puede ser el de respaldo). */
  companyName: string;
  /** Esta instalación tiene el botón "Conectar con Meta" (registro integrado de WhatsApp). */
  quickWhatsApp?: boolean;
};

const RULES = `Reglas mientras trabajas:
- Yo inicio sesión y respondo los códigos de verificación y los diálogos de permisos. Cuando aparezca uno, detente y avísame.
- Los tokens y claves se copian y se pegan directo en Beliapp → Configuración → Credenciales. Nunca los escribas en el chat, en un documento ni en otro campo.
- Antes de crear algo, revisa si ya existe y úsalo. Si no existe, créalo a nombre de mi empresa. Los datos de la empresa (razón social, RUT, dirección, sitio web, correos) pregúntamelos, no los inventes.
- Pregúntame antes de pagar algo, enviar algo a revisión de Meta o encender algo que le escriba solo a los clientes (respuestas automáticas de la IA, seguimientos, píxel).
- Si algo no coincide con lo que describo (las pantallas cambian), dime qué ves y propón cómo seguir.
- Al terminar, dame un resumen de lo que quedó listo y de lo que falta.`;

/** Servidor MCP oficial de Meta para WhatsApp Business (beta); el cliente lo conecta en Claude. */
export const WHATSAPP_MCP_URL = "https://mcp.facebook.com/whatsapp_business_tools";

const WHATSAPP_MCP = `Herramientas de WhatsApp: si tienes conectado el MCP de WhatsApp Business de Meta (herramientas whatsapp_biz_*), úsalo en vez del navegador para lo que cubre: revisar la verificación del negocio (paso 1), agregar, verificar y registrar el número y el método de pago (paso 4), leer los identificadores del número y de la cuenta de WhatsApp (paso 7) y configurar y suscribir el webhook de WhatsApp (paso 8). Con él no envíes mensajes a clientes. Si no lo tienes, dime que puedo agregarlo en claude.ai → Configuración → Conectores como conector personalizado con la dirección ${WHATSAPP_MCP_URL}, y mientras tanto sigue con el navegador. Crear la app, sacar la clave secreta y generar los tokens se hace igual en el navegador.`;

const quickWhatsApp = (s: SetupStatus) =>
  `WhatsApp se conecta solo con el botón "Conectar con Meta" de ${s.origin}/settings/channels/whatsapp: pídeme que lo toque, que inicie sesión en la ventana de Meta y que elija o cree el número. Con eso Beliapp guarda las credenciales de WhatsApp y deja su webhook listo, así que en los pasos 3, 4, 6, 7 y 8 sáltate todo lo de WhatsApp (solo revisa que en WhatsApp Manager quede un método de pago, preguntándome antes). Si la empresa solo usará WhatsApp, sáltate también Instagram, Messenger y la app propia.`;

const has = (s: SetupStatus, key: string) => !s.missingEnv.includes(key);

const label = (key: string) => CREDENTIALS.find((c) => c.key === key)?.label ?? key;

const envLine = (s: SetupStatus, key: string, how: string) =>
  `   - ${label(key)}${has(s, key) ? " (ya está, no la toques)" : ""}: ${how}`;

const CREDENTIALS_PAGE = (s: SetupStatus) => `Beliapp → Configuración → Credenciales (${s.origin}/settings/credentials)`;

const namedCompany = (s: SetupStatus) =>
  s.companyName && s.companyName !== DEFAULT_ASSISTANT.companyName ? s.companyName : "";

const company = (s: SetupStatus) => (namedCompany(s) ? ` de ${namedCompany(s)}` : "");

export function metaSetupPrompt(s: SetupStatus): string {
  const urls = companyUrls(s.origin, s.companyId ?? DEFAULT_COMPANY_ID);
  const missing = s.missingEnv.filter((k) => k !== "OPENROUTER_API_KEY");
  return `Quiero que conectes Meta (WhatsApp, Instagram, Messenger y el píxel) con Beliapp, el CRM de leads${company(s)} que está en ${s.origin}. Puede que mi empresa parta desde cero en Meta. Toma el control del navegador y hazlo paso a paso.

${RULES}

${s.quickWhatsApp ? quickWhatsApp(s) : WHATSAPP_MCP}

Estado actual: ${missing.length ? `faltan estas credenciales en Beliapp: ${missing.map(label).join(", ")}.` : "todas las credenciales de Meta ya están en Beliapp."}

1. Portafolio comercial (business.facebook.com). Si no tengo uno, créalo con los datos de la empresa. En Centro de seguridad revisa si el negocio está verificado; si no, inicia la verificación y dime qué documentos piden (sin ella hay límites de mensajes de WhatsApp y no se puede publicar la app).
2. Página de Facebook y cuenta de Instagram. Revisa que exista una página de la empresa en el portafolio y una cuenta profesional de Instagram vinculada a ella. Si falta alguna, pregúntame si la creamos o si solo usaremos WhatsApp.
3. App de Meta (developers.facebook.com → Mis apps). Si ya hay una app con webhooks hacia ${s.origin}, usa esa. Si no, crea una de tipo "Empresa" vinculada al portafolio y agrégale los productos WhatsApp, Messenger, Instagram y Webhooks.
4. Número de WhatsApp (en la app → WhatsApp → Configuración de la API, o en WhatsApp Manager). Si no hay un número propio registrado, agrégalo: pregúntame cuál usar, avísame que no puede estar activo en la app de WhatsApp del teléfono (si lo está, hay que borrar esa cuenta primero), y pídeme el código que llega por SMS o llamada. Completa el nombre visible y, en WhatsApp Manager → Configuración de pago, pregúntame antes de agregar la tarjeta.
5. Píxel (Administrador de eventos → Orígenes de datos). Si no hay uno, crea un píxel web a nombre de la empresa.
6. Usuario del sistema (Configuración del negocio → Usuarios → Usuarios del sistema). Si no hay uno para Beliapp, crea uno de tipo Administrador. En Asignar activos dale control total de la app, la cuenta de WhatsApp, la página y la cuenta de Instagram; acceso al píxel; y "Ver rendimiento" en la cuenta publicitaria. Los tokens se generan desde este usuario, eligiendo la app y caducidad "Nunca", nunca con mi usuario personal.
7. Credenciales en ${CREDENTIALS_PAGE(s)}:
${envLine(s, "WHATSAPP_TOKEN", "token del usuario del sistema con whatsapp_business_messaging y whatsapp_business_management.")}
${envLine(s, "WHATSAPP_PHONE_NUMBER_ID", "en la app → WhatsApp → Configuración de la API, el identificador del número (no el número).")}
${envLine(s, "WHATSAPP_BUSINESS_ACCOUNT_ID", "en la misma pantalla, el identificador de la cuenta de WhatsApp Business.")}
${envLine(s, "META_APP_SECRET", "en la app → Configuración de la app → Básica → Clave secreta.")}
${envLine(s, "META_VERIFY_TOKEN", "inventa un texto largo al azar; se usa igual al registrar los webhooks.")}
${envLine(s, "META_PAGE_ACCESS_TOKEN", "token del usuario del sistema con la página asignada y los permisos pages_messaging, pages_manage_metadata, pages_manage_engagement, pages_read_engagement, instagram_basic, instagram_manage_messages e instagram_manage_comments.")}
${envLine(s, "META_PAGE_ID", "id de la página de Facebook (Configuración de la página → Información).")}
${envLine(s, "META_IG_ACCOUNT_ID", "id de la cuenta profesional de Instagram vinculada a la página.")}
${envLine(s, "META_ADS_TOKEN", "opcional: token del usuario del sistema con ads_read, para ver los nombres de campaña y el gasto de cada una en Métricas (con ads_management además se pueden pausar campañas en alerta desde Beliapp).")}
${envLine(s, "META_AD_ACCOUNT_ID", "opcional: id de la cuenta publicitaria (act_…), o varias separadas por coma; si queda vacío se usan todas las que vea el token de anuncios.")}
${envLine(s, "META_CAPI_TOKEN", "Administrador de eventos → el píxel → Configuración → API de Conversiones → Generar token de acceso.")}
8. Webhooks en la app (usa el mismo token de verificación del webhook que guardaste en Beliapp):
   - WhatsApp → Configuración: URL ${urls.whatsappWebhook}, suscribe el campo messages.
   - Webhooks → objeto Page: URL ${urls.metaWebhook}, campos messages, messaging_postbacks, message_reads y feed.
   - Webhooks → objeto Instagram: URL ${urls.metaWebhook}, campos messages, messaging_postbacks y comments.
   - Suscribe la página a la app (Messenger → Configuración → Generar tokens de acceso → la página → agregar suscripciones).
9. Publicar la app.${s.legal.contactEmail ? "" : ` Primero, en ${s.origin}/settings/channels/meta completa la empresa responsable y el correo de privacidad (pregúntame cuáles).`} En Configuración de la app → Básica pon la política de privacidad ${urls.privacy}, la URL de eliminación de datos ${urls.dataDeletionCallback}, un ícono y la categoría; luego cambia el modo de la app a Publicado. WhatsApp funciona sin revisión. Para que Instagram y Messenger respondan a clientes que no tienen rol en la app, Meta exige acceso avanzado a pages_messaging, instagram_manage_messages e instagram_manage_comments en Revisión de la app: prepara la solicitud y pregúntame antes de enviarla.
10. En Beliapp (${s.origin}/settings):
   - Origen de leads: ${s.whatsappNumber ? `el número de WhatsApp ya está (${s.whatsappNumber}).` : "pon el número de WhatsApp con código de país, solo dígitos."}
   - Píxel de Meta: ${s.pixel.datasetId ? `el id del píxel ya está (${s.pixel.datasetId}).` : "pega el id del píxel (Administrador de eventos → Orígenes de datos)."}${s.pixel.qualifiedStage ? "" : " Pregúntame qué etapa del funnel cuenta como lead calificado."} ${s.pixel.enabled ? "Ya está encendido." : "Déjalo apagado y pregúntame antes de encenderlo."}
11. Comprueba: en Beliapp → Configuración → Canales y Píxel de Meta cada credencial debe aparecer con su check verde. Pídeme que escriba "hola" al número de WhatsApp desde mi teléfono y revisa que aparezca en el Funnel.`;
}
