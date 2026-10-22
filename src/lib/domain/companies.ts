import bcrypt from "bcryptjs";
import type { User } from "@prisma/client";
import { db, rootDb } from "../db";
import { DEFAULT_ASSISTANT, setSetting, type AssistantSettings } from "../settings";
import { currentCompanyId, withCompany } from "../tenant";
import { ensureDefaultFunnel } from "./default-funnel";

/**
 * Empresas que usan Beliapp. Cada una tiene sus datos, configuración y credenciales (ver
 * tenant.ts); el dueño de Beliapp (`User.superadmin`) las crea y puede entrar a cualquiera.
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
    // La asistente parte con el nombre de la empresa; el resto lo redacta "Presenta a tu asistente".
    await setSetting<AssistantSettings>("assistant", { ...DEFAULT_ASSISTANT, companyName: name });
  });
  return { id: company.id };
}

export type CompanySummary = {
  id: string;
  name: string;
  createdAt: Date;
  suspendedAt: Date | null;
  users: number;
  openLeads: number;
};

/** Todas las empresas no eliminadas con sus usuarios activos y leads abiertos. */
export async function listCompanies(): Promise<CompanySummary[]> {
  const [companies, users, leads] = await Promise.all([
    rootDb.company.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, createdAt: true, suspendedAt: true } }),
    rootDb.user.groupBy({ by: ["companyId"], where: { active: true }, _count: { _all: true } }),
    rootDb.lead.groupBy({ by: ["companyId"], where: { status: "OPEN" }, _count: { _all: true } }),
  ]);
  const count = (rows: { companyId: string; _count: { _all: number } }[], id: string) =>
    rows.find((r) => r.companyId === id)?._count._all ?? 0;
  return companies.map((c) => ({ ...c, users: count(users, c.id), openLeads: count(leads, c.id) }));
}

/** Nombres de todas las empresas, para el selector del dueño de Beliapp en la barra superior. */
export async function companyOptions(): Promise<{ id: string; name: string }[]> {
  return rootDb.company.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } });
}

export async function companyName(id: string): Promise<string | null> {
  return (await rootDb.company.findUnique({ where: { id }, select: { name: true } }))?.name ?? null;
}

export type CompanyStatus = "active" | "suspended" | "deleted";

/** Estado de una empresa; null si no existe. */
export async function companyStatus(id: string): Promise<CompanyStatus | null> {
  const company = await rootDb.company.findUnique({ where: { id }, select: { suspendedAt: true, deletedAt: true } });
  if (!company) return null;
  return company.deletedAt ? "deleted" : company.suspendedAt ? "suspended" : "active";
}

/**
 * La empresa en curso puede trabajar: no está suspendida ni eliminada. Lo revisan la IA y los
 * envíos automáticos, además de los webhooks y los cron, que ni siquiera la atienden. Una
 * empresa sin fila (instalaciones antiguas, pruebas) cuenta como activa.
 */
export async function companyActive(id?: string): Promise<boolean> {
  const status = await companyStatus(id ?? (await currentCompanyId()));
  return status === null || status === "active";
}

/** Ids de las empresas que pueden trabajar (para repartir trabajo entre varias). */
export async function activeCompanyIds(): Promise<string[]> {
  const rows = await rootDb.company.findMany({ where: { suspendedAt: null, deletedAt: null }, select: { id: true } });
  return rows.map((r) => r.id);
}

type Actor = Pick<User, "companyId">;

/** Suspende la empresa: su equipo no entra y nada automático corre para ella. Reversible. */
export async function suspendCompany(actor: Actor, id: string): Promise<string | null> {
  if (id === actor.companyId) return "No puedes suspender tu propia empresa.";
  const status = await companyStatus(id);
  if (status !== "active") return status === "suspended" ? "La empresa ya está suspendida." : "La empresa no existe.";
  await rootDb.company.update({ where: { id }, data: { suspendedAt: new Date() } });
  return null;
}

/** Vuelve a activar una empresa suspendida. */
export async function reactivateCompany(id: string): Promise<string | null> {
  if ((await companyStatus(id)) !== "suspended") return "La empresa no está suspendida.";
  await rootDb.company.update({ where: { id }, data: { suspendedAt: null } });
  return null;
}

/**
 * Elimina la empresa. Solo una suspendida, nunca la propia ni en la que se está trabajando, y
 * confirmando con su nombre. Es un borrado lógico: deja de aparecer y de funcionar, pero sus
 * datos quedan en la base por si hay que recuperarla.
 */
export async function deleteCompany(actor: Actor, id: string, confirmName: string, currentId: string): Promise<string | null> {
  if (id === actor.companyId) return "No puedes eliminar tu propia empresa.";
  if (id === currentId) return "Sal de la empresa antes de eliminarla.";
  const company = await rootDb.company.findUnique({ where: { id } });
  if (!company || company.deletedAt) return "La empresa no existe.";
  if (!company.suspendedAt) return "Primero suspende la empresa.";
  const normalize = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  if (normalize(confirmName) !== normalize(company.name)) return "El nombre no coincide.";
  await rootDb.company.update({ where: { id }, data: { deletedAt: new Date() } });
  return null;
}

/** Un usuario trabaja en su empresa; el dueño de Beliapp, además, en cualquiera. */
export function canWorkIn(user: Pick<User, "companyId" | "superadmin">, companyId: string) {
  return user.companyId === companyId || user.superadmin;
}
