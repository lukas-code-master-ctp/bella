import { Prisma, PrismaClient } from "@prisma/client";
import { currentCompanyId } from "./tenant";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Cliente sin filtro de empresa. Solo para lo que cruza empresas a propósito: iniciar sesión
 * (el correo es único entre todas), recuperar la contraseña y los procesos que recorren
 * todas las empresas. Todo lo demás usa `db`.
 */
export const rootDb = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = rootDb;

/** Modelos sin companyId: tablas de unión e hijos que solo se alcanzan desde su dueño. */
const UNSCOPED = new Set<string>(["Company", "ContactTag", "ContactFieldValue", "PasswordResetToken", "WebhookDelivery"]);

const WHERE_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
  "upsert",
]);

type Args = { where?: object; data?: object | object[]; create?: object };

/**
 * Agrega la empresa de la solicitud (ver tenant.ts) al `where` de cada consulta y al `data` de
 * cada creación, así una empresa nunca lee ni toca datos de otra. Las creaciones anidadas
 * (un `create` dentro de otro) no pasan por aquí: toman el valor por defecto de la columna.
 */
const tenantScope = Prisma.defineExtension({
  name: "tenant-scope",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (UNSCOPED.has(model)) return query(args);
        const companyId = await currentCompanyId();
        const a = (args ?? {}) as Args;
        if (WHERE_OPS.has(operation)) a.where = { ...a.where, companyId };
        if (operation === "create") a.data = { companyId, ...a.data };
        if (operation === "createMany" || operation === "createManyAndReturn") {
          a.data = Array.isArray(a.data) ? a.data.map((d) => ({ companyId, ...d })) : { companyId, ...a.data };
        }
        if (operation === "upsert") a.create = { companyId, ...a.create };
        return query(a as typeof args);
      },
    },
  },
});

// La extensión solo cambia las consultas, no la forma del cliente: se expone con el tipo de
// PrismaClient para que las funciones que reciben `db` o una transacción sigan igual.
export const db = rootDb.$extends(tenantScope) as unknown as PrismaClient;

/** Choque con un índice único: otro proceso ya guardó lo mismo. */
export const isDuplicate = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
