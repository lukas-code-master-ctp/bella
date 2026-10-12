import bcrypt from "bcryptjs";
import type { User } from "@prisma/client";
import { db, rootDb } from "../db";
import { withCompany } from "../tenant";
import { ensureDefaultFunnel } from "./default-funnel";

/**
 * Empresas que usan Bella. Cada una tiene sus datos, configuración y credenciales (ver
 * tenant.ts); el dueño de Bella (`User.superadmin`) las crea y puede entrar a cualquiera.
 */

const STARTER_STAGES = [
  { name: "Nuevo", color: "#64748b" },
  { name: "Calificado", color: "#0ea5e9" },
  { name: "Interesado", color: "#8b5cf6" },
  { name: "Atención humana", color: "#f59e0b", requiresHuman: true },
];

const STARTER_TAGS = [
  { category: "Interés", name: "Alto", color: "#16a34a" },
  { category: "Interés", name: "Medio", color: "#ca8a04" },
  { category: "Interés", name: "Bajo", color: "#dc2626" },
];

/** Embudo principal con etapas y etiquetas de ejemplo para la empresa en curso, si no tiene. */
export async function seedStarterData() {
  const { id: funnelId } = await ensureDefaultFunnel(db);
  if ((await db.stage.count()) === 0) {
    await db.stage.createMany({ data: STARTER_STAGES.map((s, position) => ({ ...s, funnelId, position })) });
  }
  if ((await db.tag.count()) === 0) await db.tag.createMany({ data: STARTER_TAGS });
}

export type NewCompany = { name: string; adminName: string; adminEmail: string; adminPassword: string };

/** Crea la empresa con su primer administrador y datos de ejemplo. Devuelve el error a mostrar o el id. */
export async function createCompany(input: NewCompany): Promise<{ error: string } | { id: string }> {
  const name = input.name.trim();
  const email = input.adminEmail.trim().toLowerCase();
  if (!name) return { error: "Falta el nombre de la empresa." };
  if (!input.adminName.trim() || !email) return { error: "Falta el nombre o el correo del administrador." };
  if (input.adminPassword.length < 8) return { error: "La contraseña debe tener al menos 8 caracteres." };
  // El correo es único entre todas las empresas: con él se inicia sesión.
  if (await rootDb.user.findUnique({ where: { email } })) return { error: "Ya existe un usuario con ese correo." };

  const company = await rootDb.company.create({ data: { name } });
  await withCompany(company.id, async () => {
    await db.user.create({
      data: { name: input.adminName.trim(), email, role: "ADMIN", passwordHash: await bcrypt.hash(input.adminPassword, 10) },
    });
    await seedStarterData();
  });
  return { id: company.id };
}

export type CompanySummary = { id: string; name: string; createdAt: Date; users: number; openLeads: number };

/** Todas las empresas con sus usuarios activos y leads abiertos. */
export async function listCompanies(): Promise<CompanySummary[]> {
  const [companies, users, leads] = await Promise.all([
    rootDb.company.findMany({ orderBy: { createdAt: "asc" } }),
    rootDb.user.groupBy({ by: ["companyId"], where: { active: true }, _count: { _all: true } }),
    rootDb.lead.groupBy({ by: ["companyId"], where: { status: "OPEN" }, _count: { _all: true } }),
  ]);
  const count = (rows: { companyId: string; _count: { _all: number } }[], id: string) =>
    rows.find((r) => r.companyId === id)?._count._all ?? 0;
  return companies.map((c) => ({ ...c, users: count(users, c.id), openLeads: count(leads, c.id) }));
}

export async function companyName(id: string): Promise<string | null> {
  return (await rootDb.company.findUnique({ where: { id }, select: { name: true } }))?.name ?? null;
}

/** Un usuario trabaja en su empresa; el dueño de Bella, además, en cualquiera. */
export function canWorkIn(user: Pick<User, "companyId" | "superadmin">, companyId: string) {
  return user.companyId === companyId || user.superadmin;
}
