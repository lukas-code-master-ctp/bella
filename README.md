# Bella

CRM de leads con asistente IA: funnel de ventas, etiquetas, asignación automática de ejecutivos,
tickets ganados/perdidos y una asistente (Claude) que conversa con los leads usando la base de
conocimiento de la empresa y el inventario de una planilla de Google Sheets.

El plan completo por fases está en el proyecto (WhatsApp, Instagram/Facebook, métricas, píxel de
Meta, campañas y UTM vienen en las siguientes fases).

## Qué incluye esta versión

- **Perfiles admin y ejecutivo.** El admin ve todo y configura; el ejecutivo ve solo sus leads.
- **Funnel kanban** con etapas configurables y arrastrar y soltar. Las etapas marcadas como
  *atención humana* pausan a la IA y asignan un ejecutivo.
- **Etiquetas por categoría** (ej. Producto, Interés). Un contacto tiene una etiqueta por categoría.
- **Asignación automática** por reglas (al entrar a una etapa o recibir una etiqueta), con rotación
  o menor carga. Sin regla, la etapa de atención humana asigna al ejecutivo con menos leads abiertos.
- **Ganado / perdido** con monto o motivo de pérdida, y opción de reabrir.
- **Asistente IA** que responde, busca en la base de conocimiento y el inventario, etiqueta,
  mueve etapas y deriva a un humano. Todo lo que hace queda en el historial del lead.
- **Simulador** para conversar con la asistente como si fueras un cliente, sin conectar canales.
- **Configuración:** instrucciones de la asistente, etapas, etiquetas, reglas, base de conocimiento,
  inventario (Google Sheets) y usuarios.

## Correr en local

Requisitos: Node 22 y Postgres 16.

```bash
npm install
cp .env.example .env          # completa DATABASE_URL, DIRECT_URL, SESSION_SECRET y OPENROUTER_API_KEY
npx prisma migrate deploy     # crea las tablas
SEED_ADMIN_PASSWORD=una-clave npm run db:seed   # admin@bella.local + etapas de ejemplo
npm run dev
```

Abre http://localhost:3000, entra con `admin@bella.local` y la clave que definiste, y prueba en
**Simulador**.

### Pruebas

Las pruebas usan una base Postgres aparte (`TEST_DATABASE_URL`, por defecto
`postgresql://postgres:postgres@localhost:5432/bella_test`):

```bash
npm test
```

## Desplegar (Vercel + Supabase)

Cada build de producción en Vercel aplica las migraciones pendientes y crea el admin, las etapas
y las etiquetas de ejemplo si no existen, así que no hay que correr nada a mano. Los previews de
los PR no tocan la base (`scripts/db-setup.mjs`): usan la de producción tal como está.

1. **Supabase:** crea un proyecto (región São Paulo es la más cercana a Chile). En
   *Connect → ORMs → Prisma* copia las dos URLs:
   - `DATABASE_URL`: la del *Transaction pooler* (puerto 6543), con `?pgbouncer=true` al final.
   - `DIRECT_URL`: la del *Session pooler* (puerto 5432).
2. **Vercel:** *Add New → Project*, importa este repositorio y, antes de desplegar, agrega
   estas variables de entorno:
   - `DATABASE_URL` y `DIRECT_URL` (del paso 1)
   - `SESSION_SECRET`: un texto largo al azar (`openssl rand -base64 32`)
   - `OPENROUTER_API_KEY`: clave de https://openrouter.ai/keys (o `ANTHROPIC_API_KEY` para usar
     la API de Anthropic directo)
   - `SEED_ADMIN_EMAIL` y `SEED_ADMIN_PASSWORD`: el usuario admin inicial
   - `CRON_SECRET`: un texto largo al azar; Vercel lo usa para llamar la sincronización diaria del
     inventario, el cierre automático y la revisión de seguimientos (`vercel.json`)
   - `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY` (opcional): activan los avisos push al navegador.
     Genéralas una vez con `npx web-push generate-vapid-keys`. Sin ellas los avisos quedan solo en
     la página **Avisos**.
   - Notas de voz: en *Storage → Create → Blob* crea un Blob store y conéctalo al proyecto; Vercel
     agrega solo `BLOB_STORE_ID` (o `BLOB_READ_WRITE_TOKEN` en conexiones antiguas). Los audios se transcriben con OpenRouter
     (`OPENROUTER_API_KEY`; el modelo se puede cambiar con `TRANSCRIPTION_MODEL`, por defecto
     `google/gemini-2.5-flash`).
3. Despliega. Entra con el correo y la clave del admin y prueba en **Simulador**.

## Inventario desde Google Sheets

En Configuración → Inventario pega el enlace de la planilla. Debe estar compartida como
"Cualquier persona con el enlace: Lector"; se lee la pestaña del enlace y la primera fila son los
nombres de columna. La asistente busca en todas las columnas, así que conviene incluir nombre,
características, precio y stock.

El inventario se actualiza solo: cuando la asistente lo consulta y la copia guardada tiene más de
15 minutos, lo vuelve a leer de la planilla antes de responder; además, Vercel Cron lo sincroniza
una vez al día (`/api/cron/inventory`, protegido con `CRON_SECRET`). En el plan Hobby de Vercel los
cron solo pueden correr una vez al día; en Pro se puede subir la frecuencia en `vercel.json`. Si la
planilla falla, la asistente sigue usando la última copia y el error aparece en Configuración.

## Seguimiento de leads inactivos

En Configuración → Seguimientos se activa y se definen los plazos (por defecto 3 h, 1 día, 3 días
y 7 días sin respuesta, contados desde el último mensaje de la IA), el horario de envío en hora de
Chile y cómo escribir los mensajes. La IA también agenda un recontacto para una fecha cuando el
cliente lo pide (`schedule_follow_up`). Solo aplica a leads abiertos con la IA activa; si un
ejecutivo escribió último, no hay seguimiento automático.

Los seguimientos vencidos se revisan con Vercel Cron cada 15 minutos (`/api/cron/follow-ups`,
protegido con `CRON_SECRET`; requiere el plan Pro, en Hobby los cron corren solo una vez al día) y,
mientras alguien usa la app, cada 5 minutos como máximo. En WhatsApp solo salen si la IA del canal
está encendida (Configuración → Canales).

## WhatsApp

Bella usa la API oficial de WhatsApp Cloud, directa con Meta. Pasos:

1. En [developers.facebook.com](https://developers.facebook.com) crea una app tipo "Empresa" con el
   producto WhatsApp y agrega el número.
2. En Vercel define `WHATSAPP_TOKEN` (token permanente de un usuario del sistema del Business
   Manager con `whatsapp_business_messaging` y `whatsapp_business_management`),
   `WHATSAPP_PHONE_NUMBER_ID`, `META_APP_SECRET` y `META_VERIFY_TOKEN` (un texto que inventas).
3. En la app de Meta, WhatsApp → Configuración → Webhook: URL `https://<tu-dominio>/api/webhooks/whatsapp`,
   el mismo `META_VERIFY_TOKEN`, y suscribe el campo `messages`.
4. En Configuración → Canales revisa que todo esté en verde y, cuando quieras, enciende "La
   asistente responde sola en WhatsApp" (viene apagado: el equipo responde a mano).

Cada mensaje entrante crea o reutiliza el contacto (por su número) y su lead abierto; si el último
lead está cerrado, abre uno nuevo. Las notas de voz se descargan y transcriben como en el
simulador; imágenes, documentos y ubicaciones llegan como texto descriptivo. Las respuestas de la
IA y del equipo salen por WhatsApp y en el chat se ve si se enviaron, entregaron o leyeron, o por
qué fallaron (por ejemplo, la ventana de 24 horas de WhatsApp).

## Instagram y Facebook Messenger

Los mensajes directos de Instagram y de la página de Facebook entran igual que WhatsApp, por la
misma app de Meta:

1. Vincula la cuenta profesional de Instagram a la página de Facebook y agrega a la app los
   productos Messenger e Instagram.
2. En Vercel define `META_PAGE_ACCESS_TOKEN` (token permanente de la página), `META_PAGE_ID` y,
   opcional, `META_IG_ACCOUNT_ID`. `META_APP_SECRET` y `META_VERIFY_TOKEN` son los mismos de WhatsApp.
3. En Webhooks registra `https://<tu-dominio>/api/webhooks/meta` para los objetos Page e Instagram y
   suscribe `messages`, `messaging_postbacks`, `message_reads`, `comments` (Instagram) y `feed`
   (Page); suscribe la página a la app.
4. En Configuración → Canales enciende la asistente por canal cuando quieras.

Los comentarios nuevos en publicaciones de Instagram (campo `comments`) y de la página (campo
`feed`) llegan a la pestaña Comentarios: se responden en público, por mensaje privado (uno por
comentario, dentro de 7 días; si la persona contesta, entra como lead) o se ocultan.

Hasta que Meta apruebe `pages_messaging`, `instagram_manage_messages`, `instagram_manage_comments`
y `pages_manage_engagement` en la revisión de la app, solo funciona con personas que tengan un rol
en la app.

## Revisión de la app de Meta

Bella publica lo que Meta pide para revisar la app: la política de privacidad en `/privacidad` y
las instrucciones de borrado en `/eliminacion-de-datos` (ambas públicas). En la app de Meta,
Configuración → Básica, pega la URL de la política y, como "URL de devolución de llamada de
eliminación de datos", `https://<tu-dominio>/api/webhooks/meta/data-deletion`: cuando alguien pide
borrar sus datos, Bella elimina sus contactos de Instagram o Facebook (con leads y conversaciones)
y sus comentarios, y le entrega un código para consultar el estado. La empresa responsable y el
correo de contacto se editan en Configuración → Canales.

## Cómo está construido

- Next.js 15 (App Router, server actions) + TypeScript + Tailwind.
- Postgres con Prisma (`prisma/schema.prisma`).
- `src/lib/domain/`: reglas de negocio (mover etapa, etiquetar, cerrar, asignar).
- `src/lib/ai/`: la asistente. `agent.ts` corre el ciclo y guarda el historial completo de cada
  conversación sin editarlo (solo se agrega al final). `providers.ts` traduce a cada API
  (OpenRouter u Anthropic directo). `tools.ts` define lo que la asistente puede hacer en el CRM.
- El proveedor, el modelo y el esfuerzo se eligen en Configuración → Asistente IA. Con OpenRouter
  se listan solo los modelos que aceptan herramientas.
