import { afterAll, afterEach, beforeEach } from "vitest";

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/bella_test";
process.env.SESSION_SECRET ??= "test-secret-test-secret";

const { db, rootDb } = await import("@/lib/db");
const { clearCredentialCache } = await import("@/lib/credentials");
const { DEFAULT_COMPANY_ID, setFallbackCompanyId } = await import("@/lib/tenant");
const { primaryFunnelIdFor } = await import("@/lib/domain/default-funnel");
const { TEST_COMPANY_ID } = await import("./company");

/**
 * Las pruebas corren como una empresa que no es la por defecto: así, un dato que se crea sin
 * pasar por el filtro de empresa (una creación anidada, SQL a mano) cae en "default" y la
 * revisión de afterEach lo detecta.
 */
setFallbackCompanyId(TEST_COMPANY_ID);

async function truncateAll() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`,
  );
}

beforeEach(async () => {
  await truncateAll();
  await db.$executeRawUnsafe(`INSERT INTO "Company" ("id", "name") VALUES ('${TEST_COMPANY_ID}', 'Empresa de prueba')`);
  // Como una empresa recién creada: con su embudo principal.
  await db.$executeRawUnsafe(
    `INSERT INTO "Funnel" ("id", "companyId", "name", "position") VALUES ('${primaryFunnelIdFor(TEST_COMPANY_ID)}', '${TEST_COMPANY_ID}', 'Principal', 0)`,
  );
  clearCredentialCache();
});

afterEach(async () => {
  const tables = await rootDb.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'companyId'`;
  const leaked: string[] = [];
  for (const { table_name } of tables) {
    const [{ n }] = await rootDb.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM "${table_name}" WHERE "companyId" NOT IN ('${TEST_COMPANY_ID}', 'empresa-a', 'empresa-b')
       AND "companyId" NOT IN (SELECT "id" FROM "Company" WHERE "id" <> '${DEFAULT_COMPANY_ID}')`,
    );
    if (n) leaked.push(`${table_name} (${n})`);
  }
  if (leaked.length) throw new Error(`Datos fuera de la empresa en curso: ${leaked.join(", ")}`);
});

// La base queda vacía al terminar: el build de CI corre el seed sobre ella, y el embudo
// "Principal" de la empresa de prueba chocaría con el de la empresa por defecto.
afterAll(truncateAll);
