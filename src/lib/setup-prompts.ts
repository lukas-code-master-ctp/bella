/**
 * Prompts para "Configurar con Claude": el admin copia uno, lo pega en Claude (con acceso a su
 * navegador) y Claude hace la configuración por él. Sirven para cualquier empresa, también una
 * que parte desde cero (sin portafolio de Meta, número de WhatsApp ni píxel): cada paso dice qué
 * revisar y qué crear si no existe. Se arman con lo que ya está configurado, así Claude salta lo
 * que está listo. Nunca incluyen valores secretos, solo qué variables faltan.
 */

import { DEFAULT_ASSISTANT } from "./settings";

export type SetupStatus = {
  /** Dirección de esta instalación, ej. https://crm.empresa.cl */
  origin: string;
  /** Variables de entorno que faltan en Vercel. */
  missingEnv: string[];
  whatsappNumber: string;
  pixel: { enabled: boolean; datasetId: string; qualifiedStage: string | null };
  legal: { legalName: string; contactEmail: string };
  assistant: { assistantName: string; companyName: string };
  knowledgeDocs: number;
  inventorySheet: boolean;
  stages: string[];
  fields: number;
  followUps: boolean;
  executives: number;
};

const RULES = `Reglas mientras trabajas:
- Yo inicio sesión y respondo los códigos de verificación y los diálogos de permisos. Cuando aparezca uno, detente y avísame.
- Los tokens y claves se copian y se pegan directo en Vercel. Nunca los escribas en el chat, en un documento ni en un campo que no sea el de la variable.
- Antes de crear algo, revisa si ya existe y úsalo. Si no existe, créalo a nombre de mi empresa. Los datos de la empresa (razón social, RUT, dirección, sitio web, correos) pregúntamelos, no los inventes.
- Pregúntame antes de pagar algo, enviar algo a revisión de Meta o encender algo que le escriba solo a los clientes (respuestas automáticas de la IA, seguimientos, píxel).
- Si algo no coincide con lo que describo (las pantallas cambian), dime qué ves y propón cómo seguir.
- Al terminar, dame un resumen de lo que quedó listo y de lo que falta.`;

const has = (s: SetupStatus, key: string) => !s.missingEnv.includes(key);

const envLine = (s: SetupStatus, key: string, how: string) =>
  `   - ${key}${has(s, key) ? " (ya está, no la toques)" : ""}: ${how}`;

const VERCEL = (s: SetupStatus) =>
  `Vercel (vercel.com → el proyecto que publica ${s.origin} → Settings → Environment Variables, ambiente Production)`;

const namedCompany = (s: SetupStatus) =>
  s.assistant.companyName && s.assistant.companyName !== DEFAULT_ASSISTANT.companyName ? s.assistant.companyName : "";

const company = (s: SetupStatus) => (namedCompany(s) ? ` de ${namedCompany(s)}` : "");

export function metaSetupPrompt(s: SetupStatus): string {
  const base = `${s.origin}/api/webhooks`;
  const missing = s.missingEnv.filter((k) => k !== "OPENROUTER_API_KEY");
  return `Quiero que conectes Meta (WhatsApp, Instagram, Messenger y el píxel) con Bella, el CRM de leads${company(s)} que está en ${s.origin}. Puede que mi empresa parta desde cero en Meta. Toma el control del navegador y hazlo paso a paso.

${RULES}

Estado actual: ${missing.length ? `faltan estas variables en Vercel: ${missing.join(", ")}.` : "todas las variables de Meta ya están en Vercel."}

1. Portafolio comercial (business.facebook.com). Si no tengo uno, créalo con los datos de la empresa. En Centro de seguridad revisa si el negocio está verificado; si no, inicia la verificación y dime qué documentos piden (sin ella hay límites de mensajes de WhatsApp y no se puede publicar la app).
2. Página de Facebook y cuenta de Instagram. Revisa que exista una página de la empresa en el portafolio y una cuenta profesional de Instagram vinculada a ella. Si falta alguna, pregúntame si la creamos o si solo usaremos WhatsApp.
3. App de Meta (developers.facebook.com → Mis apps). Si ya hay una app con webhooks hacia ${s.origin}, usa esa. Si no, crea una de tipo "Empresa" vinculada al portafolio y agrégale los productos WhatsApp, Messenger, Instagram y Webhooks.
4. Número de WhatsApp (en la app → WhatsApp → Configuración de la API, o en WhatsApp Manager). Si no hay un número propio registrado, agrégalo: pregúntame cuál usar, avísame que no puede estar activo en la app de WhatsApp del teléfono (si lo está, hay que borrar esa cuenta primero), y pídeme el código que llega por SMS o llamada. Completa el nombre visible y, en WhatsApp Manager → Configuración de pago, pregúntame antes de agregar la tarjeta.
5. Píxel (Administrador de eventos → Orígenes de datos). Si no hay uno, crea un píxel web a nombre de la empresa.
6. Usuario del sistema (Configuración del negocio → Usuarios → Usuarios del sistema). Si no hay uno para Bella, crea uno de tipo Administrador. En Asignar activos dale control total de la app, la cuenta de WhatsApp, la página y la cuenta de Instagram; acceso al píxel; y "Ver rendimiento" en la cuenta publicitaria. Los tokens se generan desde este usuario, eligiendo la app y caducidad "Nunca", nunca con mi usuario personal.
7. Variables en ${VERCEL(s)}:
${envLine(s, "WHATSAPP_TOKEN", "token del usuario del sistema con whatsapp_business_messaging y whatsapp_business_management.")}
${envLine(s, "WHATSAPP_PHONE_NUMBER_ID", "en la app → WhatsApp → Configuración de la API, el identificador del número (no el número).")}
${envLine(s, "WHATSAPP_BUSINESS_ACCOUNT_ID", "en la misma pantalla, el identificador de la cuenta de WhatsApp Business.")}
${envLine(s, "META_APP_SECRET", "en la app → Configuración de la app → Básica → Clave secreta.")}
${envLine(s, "META_VERIFY_TOKEN", "inventa un texto largo al azar; se usa igual al registrar los webhooks.")}
${envLine(s, "META_PAGE_ACCESS_TOKEN", "token del usuario del sistema con la página asignada y los permisos pages_messaging, pages_manage_metadata, pages_manage_engagement, pages_read_engagement, instagram_basic, instagram_manage_messages e instagram_manage_comments.")}
${envLine(s, "META_PAGE_ID", "id de la página de Facebook (Configuración de la página → Información).")}
${envLine(s, "META_IG_ACCOUNT_ID", "id de la cuenta profesional de Instagram vinculada a la página.")}
${envLine(s, "META_ADS_TOKEN", "opcional: token del usuario del sistema con ads_read, para ver los nombres de campaña.")}
${envLine(s, "META_CAPI_TOKEN", "Administrador de eventos → el píxel → Configuración → API de Conversiones → Generar token de acceso.")}
   Al terminar, en Vercel → Deployments → el último de producción → Redeploy (una sola vez).
8. Webhooks en la app (usa el valor de META_VERIFY_TOKEN como token de verificación):
   - WhatsApp → Configuración: URL ${base}/whatsapp, suscribe el campo messages.
   - Webhooks → objeto Page: URL ${base}/meta, campos messages, messaging_postbacks, message_reads y feed.
   - Webhooks → objeto Instagram: URL ${base}/meta, campos messages, messaging_postbacks y comments.
   - Suscribe la página a la app (Messenger → Configuración → Generar tokens de acceso → la página → agregar suscripciones).
9. Publicar la app.${s.legal.contactEmail ? "" : ` Primero, en ${s.origin}/settings/channels completa la empresa responsable y el correo de privacidad (pregúntame cuáles).`} En Configuración de la app → Básica pon la política de privacidad ${s.origin}/privacidad, la URL de eliminación de datos ${base}/meta/data-deletion, un ícono y la categoría; luego cambia el modo de la app a Publicado. WhatsApp funciona sin revisión. Para que Instagram y Messenger respondan a clientes que no tienen rol en la app, Meta exige acceso avanzado a pages_messaging, instagram_manage_messages e instagram_manage_comments en Revisión de la app: prepara la solicitud y pregúntame antes de enviarla.
10. En Bella (${s.origin}/settings):
   - Origen de leads: ${s.whatsappNumber ? `el número de WhatsApp ya está (${s.whatsappNumber}).` : "pon el número de WhatsApp con código de país, solo dígitos."}
   - Píxel de Meta: ${s.pixel.datasetId ? `el id del píxel ya está (${s.pixel.datasetId}).` : "pega el id del píxel (Administrador de eventos → Orígenes de datos)."}${s.pixel.qualifiedStage ? "" : " Pregúntame qué etapa del funnel cuenta como lead calificado."} ${s.pixel.enabled ? "Ya está encendido." : "Déjalo apagado y pregúntame antes de encenderlo."}
11. Comprueba: en Bella → Configuración → Canales y Píxel de Meta cada variable debe aparecer con su check verde. Pídeme que escriba "hola" al número de WhatsApp desde mi teléfono y revisa que aparezca en el Funnel.`;
}

export function assistantSetupPrompt(s: SetupStatus): string {
  const aiKey = has(s, "OPENROUTER_API_KEY");
  return `Quiero que configures la asistente de IA de Bella, el CRM de leads${company(s)} que está en ${s.origin}. Puede que esté recién instalado, sin nada configurado. Toma el control del navegador; las pantallas están en ${s.origin}/settings.

${RULES}

Antes de cambiar nada, hazme estas preguntas en un solo mensaje (y usa lo que me respondas): qué vendemos y a quién, cómo se llama la empresa y cómo queremos que se llame y hable la asistente, qué datos debe pedir para calificar a un cliente, cuáles son las etapas reales de nuestra venta, cuándo debe pasar la conversación a una persona, quiénes son los ejecutivos y dónde están nuestras preguntas frecuentes, políticas e inventario.

Estado actual: asistente "${s.assistant.assistantName}"${namedCompany(s) ? ` de "${namedCompany(s)}"` : ", sin el nombre de la empresa"}; clave de IA ${aiKey ? "configurada" : "sin configurar"}; ${s.knowledgeDocs} documentos en la base de conocimiento; inventario ${s.inventorySheet ? "conectado a un Google Sheet" : "sin conectar"}; etapas del funnel: ${s.stages.join(", ") || "ninguna"}; ${s.fields} campos del cliente; ${s.executives} ejecutivos; seguimientos ${s.followUps ? "encendidos" : "apagados"}.

1. Clave de IA: ${aiKey ? "ya está, no la toques." : `en openrouter.ai crea una cuenta a nombre de la empresa, pregúntame antes de cargar crédito, crea una clave en Keys y pégala en ${VERCEL(s)} como OPENROUTER_API_KEY. Luego Deployments → el último de producción → Redeploy.`} Después, en Asistente IA elige el modelo (pregúntame si prefiero calidad o costo).
2. Asistente: nombre, empresa e instrucciones (tono, preguntas para calificar de a una, qué no decir, cuándo derivar). Los productos y políticas no van aquí, van en la base de conocimiento. Si ya hay instrucciones, mantenlas y propón los cambios antes de guardar.
3. Base de conocimiento: un documento por tema (preguntas frecuentes, precios y formas de pago, proceso de compra, ubicación, políticas), en texto claro y solo con datos que yo te dé.
4. Inventario (si vendemos productos con stock): pega la URL del Google Sheet compartido como "Cualquier persona con el enlace: Lector" y sincroniza. Revisa que las columnas tengan nombres claros (producto, precio, stock, ubicación).
5. Funnel y etiquetas: las etapas de ejemplo (Nuevo, Calificado, Interesado) son genéricas; reemplázalas por las de nuestra venta en su orden real, con una de "Atención humana". Etiquetas por categoría (ej. Producto, Interés: alto/medio/bajo).
6. Campos del cliente: los datos que la IA debe ir completando (ej. RUT, presupuesto, plazo, región), con una indicación de cuándo preguntarlos.
7. Usuarios: crea a cada ejecutivo con su nombre y correo (pregúntame la lista); la clave inicial la escribo yo en el formulario.
8. Asignación: reglas para repartir los leads entre los ejecutivos (pregúntame quién atiende qué).
9. Seguimientos y cierre automático: propón tiempos razonables, pero déjalos como estén y pregúntame antes de encenderlos.
10. Prueba en el Simulador (${s.origin}/simulator) con 3 conversaciones distintas: un cliente interesado, uno que pregunta precio y stock, y uno que pide hablar con una persona. Revisa que la IA no invente precios, que mueva de etapa, que etiquete y que derive bien. Ajusta las instrucciones si algo falla y cuéntame qué cambiaste.`;
}
