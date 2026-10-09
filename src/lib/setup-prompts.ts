/**
 * Prompts para "Configurar con Claude": el admin copia uno, lo pega en Claude (con acceso a su
 * navegador) y Claude hace la configuración por él. Se arman con lo que ya está configurado, así
 * Claude solo hace lo que falta. Nunca incluyen valores secretos, solo qué variables faltan.
 */

export type SetupStatus = {
  /** Dirección de Bella, ej. https://bella.vercel.app */
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
};

const RULES = `Reglas mientras trabajas:
- Yo inicio sesión y respondo los códigos de verificación y los diálogos de permisos. Cuando aparezca uno, detente y avísame.
- Los tokens y claves se copian de Meta y se pegan directo en Vercel. Nunca los escribas en el chat, en un documento ni en un campo que no sea el de la variable.
- Genera los tokens con un usuario del sistema del Business Manager y caducidad "Nunca", no con mi usuario personal.
- No enciendas nada que le escriba solo a los clientes (respuestas automáticas de la IA, seguimientos, píxel) sin preguntarme antes.
- Si algo no coincide con lo que describo (Meta cambia sus pantallas), dime qué ves y propón cómo seguir.
- Al terminar, dame un resumen de lo que quedó listo y de lo que falta.`;

const has = (s: SetupStatus, key: string) => !s.missingEnv.includes(key);

const envLine = (s: SetupStatus, key: string, how: string) =>
  `- ${key}${has(s, key) ? " (ya está, no la toques)" : ""}: ${how}`;

export function metaSetupPrompt(s: SetupStatus): string {
  const base = `${s.origin}/api/webhooks`;
  const missing = s.missingEnv.filter((k) => k !== "OPENROUTER_API_KEY");
  return `Quiero que configures la conexión de Meta (WhatsApp, Instagram, Messenger y el píxel) de Bella, nuestro CRM de leads en ${s.origin}. Toma el control del navegador y hazlo paso a paso.

${RULES}

Estado actual: ${missing.length ? `faltan estas variables en Vercel: ${missing.join(", ")}.` : "todas las variables de Meta ya están en Vercel."}

1. App de Meta (developers.facebook.com → Mis apps). Usa la app de Bella; si no existe, créala de tipo "Empresa" y agrégale los productos WhatsApp, Messenger e Instagram.
2. Variables en Vercel (vercel.com → proyecto bella → Settings → Environment Variables, ambiente Production):
${envLine(s, "WHATSAPP_TOKEN", "token permanente del usuario del sistema con permisos whatsapp_business_messaging y whatsapp_business_management.")}
${envLine(s, "WHATSAPP_PHONE_NUMBER_ID", "en la app → WhatsApp → Configuración de la API, el identificador del número (no el número).")}
${envLine(s, "WHATSAPP_BUSINESS_ACCOUNT_ID", "en la misma pantalla, el identificador de la cuenta de WhatsApp Business.")}
${envLine(s, "META_APP_SECRET", "en la app → Configuración de la app → Básica → Clave secreta.")}
${envLine(s, "META_VERIFY_TOKEN", "inventa un texto largo al azar; se usa igual al registrar los webhooks.")}
${envLine(s, "META_PAGE_ACCESS_TOKEN", "token permanente de la página de Facebook (usuario del sistema con la página asignada; permisos pages_messaging, pages_manage_metadata, pages_manage_engagement, pages_read_engagement, instagram_basic, instagram_manage_messages, instagram_manage_comments).")}
${envLine(s, "META_PAGE_ID", "id de la página de Facebook (Configuración de la página → Información).")}
${envLine(s, "META_IG_ACCOUNT_ID", "id de la cuenta profesional de Instagram vinculada a la página.")}
${envLine(s, "META_ADS_TOKEN", "opcional: token del usuario del sistema con ads_read y la cuenta publicitaria asignada, para ver nombres de campaña.")}
${envLine(s, "META_CAPI_TOKEN", "Administrador de eventos → el píxel → Configuración → API de Conversiones → Generar token de acceso.")}
   Después de agregarlas, en Vercel → Deployments → el último de producción → Redeploy (una sola vez al final).
3. Webhooks en la app de Meta (usa el valor de META_VERIFY_TOKEN como token de verificación):
   - WhatsApp → Configuración: URL ${base}/whatsapp, suscribe el campo messages.
   - Webhooks → objeto Page: URL ${base}/meta, campos messages, messaging_postbacks, message_reads y feed.
   - Webhooks → objeto Instagram: URL ${base}/meta, campos messages, messaging_postbacks y comments.
4. Revisión de la app: en Configuración de la app → Básica, pon la política de privacidad ${s.origin}/privacidad y la URL de eliminación de datos ${base}/meta/data-deletion.${s.legal.contactEmail ? "" : " Antes, en Bella → Configuración → Canales, completa la empresa responsable y el correo de privacidad (pregúntame cuáles)."}
5. En Bella (${s.origin}/settings):
   - Origen de leads: ${s.whatsappNumber ? `el número de WhatsApp ya está (${s.whatsappNumber}).` : "pon el número de WhatsApp con código de país, solo dígitos (pregúntame cuál)."}
   - Píxel de Meta: ${s.pixel.datasetId ? `el id del píxel ya está (${s.pixel.datasetId}).` : "pega el id del píxel (Administrador de eventos → Orígenes de datos)."}${s.pixel.qualifiedStage ? "" : " Pregúntame qué etapa del funnel cuenta como lead calificado."} ${s.pixel.enabled ? "Ya está encendido." : "Déjalo apagado y pregúntame antes de encenderlo."}
6. Comprueba: en Bella → Configuración → Canales y Píxel de Meta cada variable debe aparecer con su check verde. Si me pides un mensaje de prueba, escribe "hola" al número de WhatsApp desde mi teléfono y revisa que aparezca en el Funnel.`;
}

export function assistantSetupPrompt(s: SetupStatus): string {
  return `Quiero que configures la asistente de IA de Bella, nuestro CRM de leads en ${s.origin}. Toma el control del navegador; las pantallas están en ${s.origin}/settings.

${RULES}

Antes de cambiar nada, hazme estas preguntas en un solo mensaje (y usa lo que te responda): qué vendemos y a quién, cómo queremos que hable la asistente, qué datos debe pedir para calificar a un cliente, cuándo debe pasar la conversación a una persona y dónde están nuestras preguntas frecuentes, políticas e inventario.

Estado actual: asistente "${s.assistant.assistantName}" de "${s.assistant.companyName}"; ${s.knowledgeDocs} documentos en la base de conocimiento; inventario ${s.inventorySheet ? "conectado a un Google Sheet" : "sin conectar"}; etapas del funnel: ${s.stages.join(", ") || "ninguna"}; ${s.fields} campos del cliente; seguimientos ${s.followUps ? "encendidos" : "apagados"}.

1. Asistente: nombre, empresa e instrucciones (tono, preguntas para calificar de a una, qué no decir, cuándo derivar). Los productos y políticas no van aquí, van en la base de conocimiento. Mantén las instrucciones que ya existan y propón los cambios antes de guardar.
2. Base de conocimiento: un documento por tema (preguntas frecuentes, financiamiento, proceso de compra, ubicación, políticas), en texto claro y sin inventar datos.
3. Inventario: pega la URL del Google Sheet publicado como CSV (Archivo → Compartir → Publicar en la web → CSV) y sincroniza. Revisa que las columnas tengan nombres claros (producto, precio, stock, ubicación).
4. Funnel y etiquetas: etapas en el orden real de venta, con una de "Atención humana"; etiquetas por categoría (ej. Producto, Interés: alto/medio/bajo).
5. Campos del cliente: los datos que la IA debe ir completando (ej. RUT, presupuesto, plazo, región), con una indicación de cuándo preguntarlos.
6. Asignación: reglas para repartir los leads entre los ejecutivos (pregúntame quién atiende qué).
7. Seguimientos y cierre automático: propón tiempos razonables, pero déjalos como estén y pregúntame antes de encenderlos.
8. Prueba en el Simulador (${s.origin}/simulator) con 3 conversaciones distintas: un cliente interesado, uno que pregunta precio y stock, y uno que pide hablar con una persona. Revisa que la IA no invente precios, que mueva de etapa, que etiquete y que derive bien. Ajusta las instrucciones si algo falla y cuéntame qué cambiaste.`;
}
