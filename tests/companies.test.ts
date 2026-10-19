import { describe, expect, it } from "vitest";
import { db, rootDb } from "@/lib/db";
import { canWorkIn, createCompany, listCompanies } from "@/lib/domain/companies";
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
