import { describe, expect, it } from "vitest";
import { db, rootDb } from "@/lib/db";
import {
  activeCompanyIds,
  canWorkIn,
  companyActive,
  companyOptions,
  companyStatus,
  createCompany,
  deleteCompany,
  listCompanies,
  reactivateCompany,
  suspendCompany,
} from "@/lib/domain/companies";
import { primaryFunnelIdFor } from "@/lib/domain/default-funnel";
import { readSession, signSession } from "@/lib/session-token";
import { getAssistantSettings } from "@/lib/settings";
import { withCompany } from "@/lib/tenant";
import { TEST_COMPANY_ID } from "./company";

const input = { name: "Motos del Sur", adminName: "Ana Pérez", adminEmail: " Ana@Motos.cl ", adminPassword: "secreta123" };

describe("Empresas", () => {
  it("crea la empresa con su admin, su embudo de ejemplo y nada en las demás", async () => {
    const result = await createCompany(input);
    if ("error" in result) throw new Error(result.error);
    const { id } = result;

    const admin = await rootDb.user.findUniqueOrThrow({ where: { email: "ana@motos.cl" } });
    expect(admin).toMatchObject({ companyId: id, role: "ADMIN", superadmin: false, name: "Ana Pérez" });

    await withCompany(id, async () => {
      const funnel = await db.funnel.findUniqueOrThrow({ where: { id: primaryFunnelIdFor(id) } });
      expect(funnel.name).toBe("Principal");
      const stages = await db.stage.findMany({ orderBy: { position: "asc" } });
      expect(stages.map((s) => [s.name, s.funnelId])).toEqual([
        ["Nuevo", funnel.id],
        ["Calificado", funnel.id],
        ["Interesado", funnel.id],
        ["Atención humana", funnel.id],
      ]);
      expect(await db.tag.count()).toBe(3);
      expect(await getAssistantSettings()).toMatchObject({ companyName: "Motos del Sur", assistantName: "Bella" });
    });
    // La empresa en curso de la prueba no recibió nada.
    expect(await db.stage.count()).toBe(0);
    expect(await db.user.count()).toBe(0);

    expect(await listCompanies()).toEqual([
      expect.objectContaining({ id: TEST_COMPANY_ID, users: 0, openLeads: 0 }),
      expect.objectContaining({ id, name: "Motos del Sur", users: 1, openLeads: 0 }),
    ]);
  });

  it("dos empresas pueden usar los mismos nombres de embudo, etiquetas y campos", async () => {
    const a = await createCompany(input);
    const b = await createCompany({ ...input, adminEmail: "otra@motos.cl" });
    expect("id" in a && "id" in b).toBe(true);
    for (const r of [a, b]) {
      if (!("id" in r)) continue;
      await withCompany(r.id, () => db.customField.create({ data: { name: "RUT", position: 0 } }));
    }
    expect(await rootDb.funnel.count({ where: { name: "Principal" } })).toBe(3);
  });

  it("rechaza un correo repetido, contraseñas cortas y datos faltantes", async () => {
    await createCompany(input);
    expect(await createCompany(input)).toEqual({ error: "Ya existe un usuario con ese correo." });
    expect(await createCompany({ ...input, adminEmail: "x@y.cl", adminPassword: "corta" })).toEqual({
      error: "La contraseña debe tener al menos 8 caracteres.",
    });
    expect(await createCompany({ ...input, name: " " })).toEqual({ error: "Falta el nombre de la empresa." });
    expect(await rootDb.company.count()).toBe(2);
  });

  it("solo el dueño de Beliapp trabaja en otra empresa que la suya", async () => {
    const user = { companyId: "empresa-a", superadmin: false };
    expect(canWorkIn(user, "empresa-a")).toBe(true);
    expect(canWorkIn(user, "empresa-b")).toBe(false);
    expect(canWorkIn({ ...user, superadmin: true }, "empresa-b")).toBe(true);
    const session = await readSession(await signSession("u1", 60, "empresa-b"));
    expect(session?.companyId).toBe("empresa-b");
  });
});

describe("Suspender y eliminar empresas", () => {
  const owner = { companyId: TEST_COMPANY_ID };
  async function newCompany() {
    const result = await createCompany(input);
    if ("error" in result) throw new Error(result.error);
    return result.id;
  }

  it("suspende y reactiva; la propia empresa no se toca", async () => {
    const id = await newCompany();
    expect(await suspendCompany(owner, TEST_COMPANY_ID)).toBe("No puedes suspender tu propia empresa.");
    expect(await suspendCompany(owner, id)).toBeNull();
    expect(await companyStatus(id)).toBe("suspended");
    expect(await companyActive(id)).toBe(false);
    expect(await activeCompanyIds()).not.toContain(id);
    expect(await suspendCompany(owner, id)).toBe("La empresa ya está suspendida.");
    expect(await reactivateCompany(id)).toBeNull();
    expect(await companyActive(id)).toBe(true);
    expect(await reactivateCompany(id)).toBe("La empresa no está suspendida.");
  });

  it("elimina solo una suspendida, confirmando su nombre, y la oculta sin borrar sus datos", async () => {
    const id = await newCompany();
    expect(await deleteCompany(owner, id, "Motos del Sur", TEST_COMPANY_ID)).toBe("Primero suspende la empresa.");
    await suspendCompany(owner, id);
    expect(await deleteCompany(owner, id, "Motos", TEST_COMPANY_ID)).toBe("El nombre no coincide.");
    expect(await deleteCompany(owner, id, "Motos del Sur", id)).toBe("Sal de la empresa antes de eliminarla.");
    expect(await deleteCompany(owner, TEST_COMPANY_ID, "x", "otra")).toBe("No puedes eliminar tu propia empresa.");
    expect(await deleteCompany(owner, id, "  motos  del sur ", TEST_COMPANY_ID)).toBeNull();
    expect(await companyStatus(id)).toBe("deleted");
    expect(await companyActive(id)).toBe(false);
    expect((await listCompanies()).map((c) => c.id)).toEqual([TEST_COMPANY_ID]);
    expect((await companyOptions()).map((c) => c.id)).toEqual([TEST_COMPANY_ID]);
    expect(await reactivateCompany(id)).toBe("La empresa no está suspendida.");
    // Los datos siguen en la base.
    expect(await rootDb.user.count({ where: { companyId: id } })).toBe(1);
  });
});
