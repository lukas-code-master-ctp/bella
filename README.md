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
cp .env.example .env          # completa DATABASE_URL, DIRECT_URL, SESSION_SECRET y ANTHROPIC_API_KEY
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

Cada build de Vercel aplica las migraciones pendientes y crea el admin, las etapas y las
etiquetas de ejemplo si no existen, así que no hay que correr nada a mano.

1. **Supabase:** crea un proyecto (región São Paulo es la más cercana a Chile). En
   *Connect → ORMs → Prisma* copia las dos URLs:
   - `DATABASE_URL`: la del *Transaction pooler* (puerto 6543), con `?pgbouncer=true` al final.
   - `DIRECT_URL`: la del *Session pooler* (puerto 5432).
2. **Vercel:** *Add New → Project*, importa este repositorio y, antes de desplegar, agrega
   estas variables de entorno:
   - `DATABASE_URL` y `DIRECT_URL` (del paso 1)
   - `SESSION_SECRET`: un texto largo al azar (`openssl rand -base64 32`)
   - `ANTHROPIC_API_KEY`: clave de https://console.anthropic.com
   - `SEED_ADMIN_EMAIL` y `SEED_ADMIN_PASSWORD`: el usuario admin inicial
3. Despliega. Entra con el correo y la clave del admin y prueba en **Simulador**.

## Inventario desde Google Sheets

En Configuración → Inventario pega el enlace de la planilla. Debe estar compartida como
"Cualquier persona con el enlace: Lector"; se lee la pestaña del enlace y la primera fila son los
nombres de columna. La asistente busca en todas las columnas, así que conviene incluir nombre,
características, precio y stock.

## Cómo está construido

- Next.js 15 (App Router, server actions) + TypeScript + Tailwind.
- Postgres con Prisma (`prisma/schema.prisma`).
- `src/lib/domain/`: reglas de negocio (mover etapa, etiquetar, cerrar, asignar).
- `src/lib/ai/`: la asistente. `agent.ts` corre el ciclo con la API de Claude y guarda el historial
  completo de cada conversación sin editarlo (solo se agrega al final). `tools.ts` define lo que la
  asistente puede hacer en el CRM.
- El modelo se configura con `AI_MODEL` (por defecto `claude-opus-5-5`) y el esfuerzo con
  `AI_EFFORT` (por defecto `medium`).
