# Bella

CRM de leads con asistente IA. UI y textos en español de Chile.

- Stack: Next.js 15 App Router + server actions, Prisma/Postgres, Tailwind v4, Anthropic SDK.
- Reglas de negocio en `src/lib/domain/`; las server actions solo autorizan y delegan.
- La asistente (`src/lib/ai/agent.ts`) guarda el historial de la API en `AgentTranscript` y solo
  agrega al final: no edites ni recortes mensajes previos (rompe el razonamiento preservado).
  El estado del CRM viaja en cada turno del usuario dentro de `<crm_state>`, no en el system prompt.
- Pruebas: `npm test` (Vitest contra Postgres real, base `bella_test`). Typecheck: `npm run lint`.
- Migraciones: `npx prisma migrate dev --name <cambio>`.
