import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { formatRut, parseAmount, parseFieldValue, setContactFields } from "@/lib/domain/fields";
import { createLead, DomainError } from "@/lib/domain/leads";
import { executeTool } from "@/lib/ai/tools";
import { executive, seedFunnel } from "./factories";

describe("campos del cliente", () => {
  it("valida el RUT con su dígito verificador y lo deja con puntos y guion", () => {
    expect(formatRut("12345678-5")).toBe("12.345.678-5");
    expect(formatRut("7.654.321-6")).toBe("7.654.321-6");
    expect(formatRut("10.000.013-k")).toBe("10.000.013-K");
    expect(formatRut("12345678-9")).toBeNull();
    expect(formatRut("hola")).toBeNull();
  });

  it("lee montos como los escribe un cliente chileno", () => {
    expect(parseAmount("50.000.000")).toBe(50_000_000);
    expect(parseAmount("$ 45 millones")).toBe(45_000_000);
    expect(parseAmount("1,5 MM")).toBe(1_500_000);
    expect(parseAmount("800 mil")).toBe(800_000);
    expect(parseAmount("no sé")).toBeNull();
  });

  it("acepta opciones sin importar tildes ni mayúsculas", () => {
    const field = { name: "Topografía", type: "OPTIONS" as const, options: ["Plana", "Con pendiente"] };
    expect(parseFieldValue(field, "con PENDIENTE")).toEqual({ value: "Con pendiente" });
    expect(parseFieldValue(field, "cerro")).toMatchObject({ error: expect.stringContaining("Plana, Con pendiente") });
  });

  it("la IA guarda un campo, ve el error si no es válido y queda en el historial", async () => {
    await seedFunnel();
    await db.customField.createMany({
      data: [
        { name: "RUT", type: "RUT", position: 0 },
        { name: "Presupuesto", type: "NUMBER", position: 1 },
      ],
    });
    const lead = await createLead({ name: "Ana", channel: "SIMULATOR" });

    expect(await executeTool(lead.id, "set_contact_field", { field: "presupuesto", value: "40 millones" })).toEqual({
      content: '"Presupuesto" guardado.',
    });
    expect(await executeTool(lead.id, "set_contact_field", { field: "RUT", value: "12345678-9" })).toMatchObject({
      isError: true,
    });
    expect(await executeTool(lead.id, "set_contact_field", { field: "Región", value: "Maule" })).toMatchObject({
      isError: true,
      content: expect.stringContaining("RUT, Presupuesto"),
    });

    const values = await db.contactFieldValue.findMany();
    expect(values.map((v) => [v.value, v.updatedBy])).toEqual([["40000000", "AI"]]);
    const event = await db.leadEvent.findFirstOrThrow({ where: { type: "FIELD_UPDATED" } });
    expect([event.actor, event.data]).toEqual(["AI", { field: "Presupuesto", value: "40.000.000" }]);
  });

  it("el ejecutivo corrige y borra campos; si uno es inválido no guarda ninguno", async () => {
    await seedFunnel();
    const ana = await executive("Ana");
    const [rut, comuna] = await Promise.all([
      db.customField.create({ data: { name: "RUT", type: "RUT", position: 0 } }),
      db.customField.create({ data: { name: "Comuna", type: "TEXT", position: 1 } }),
    ]);
    const lead = await createLead({ name: "Pedro", channel: "SIMULATOR" });
    const by = { actor: "USER" as const, userId: ana.id };

    await expect(setContactFields(lead.id, { [rut.id]: "1-1", [comuna.id]: "Talca" }, by)).rejects.toThrow(DomainError);
    expect(await db.contactFieldValue.count()).toBe(0);

    await setContactFields(lead.id, { [rut.id]: "123456785", [comuna.id]: "Talca" }, by);
    await setContactFields(lead.id, { [rut.id]: "12.345.678-5", [comuna.id]: "" }, by);
    const values = await db.contactFieldValue.findMany();
    expect(values.map((v) => [v.value, v.updatedBy])).toEqual([["12.345.678-5", "USER"]]);
    // Guardar el mismo RUT con otro formato no deja un evento nuevo.
    const events = await db.leadEvent.findMany({ where: { type: "FIELD_UPDATED" }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.data)).toEqual([
      { field: "RUT", value: "12.345.678-5" },
      { field: "Comuna", value: "Talca" },
      { field: "Comuna", value: null },
    ]);
  });
});
