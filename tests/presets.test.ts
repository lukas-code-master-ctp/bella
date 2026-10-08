import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { applyPreset, type Preset } from "@/lib/domain/presets";
import { COMPRA_TU_PARCELA } from "@/lib/presets/compra-tu-parcela";
import { getAssistantSettings, getSetting, setSetting } from "@/lib/settings";

const preset: Preset = {
  id: "prueba",
  version: 1,
  assistant: { assistantName: "Valentina", companyName: "Compra Tu Parcela", instructions: "Hablas de tú." },
  knowledge: [{ title: "Información Empresa", content: "Vendemos parcelas." }],
  inventorySheetUrl: "https://docs.google.com/spreadsheets/d/abc/edit",
};

describe("presets de configuración", () => {
  it("carga asistente, documentos e inventario sin tocar otros documentos", async () => {
    await db.knowledgeDoc.createMany({
      data: [
        { title: "Información Empresa", content: "Texto viejo" },
        { title: "Horario", content: "Lunes a viernes" },
      ],
    });
    expect(await applyPreset(db, preset)).toBe(true);

    expect(await getAssistantSettings()).toEqual(preset.assistant);
    const docs = await db.knowledgeDoc.findMany({ orderBy: { title: "asc" } });
    expect(docs.map((d) => [d.title, d.content])).toEqual([
      ["Horario", "Lunes a viernes"],
      ["Información Empresa", "Vendemos parcelas."],
    ]);
    expect(await getSetting("inventory", {})).toEqual({ sheetUrl: preset.inventorySheetUrl });
  });

  it("no pisa los cambios hechos después en Configuración hasta que sube la versión", async () => {
    await applyPreset(db, preset);
    await setSetting("assistant", { ...preset.assistant, instructions: "Editado a mano" });

    expect(await applyPreset(db, preset)).toBe(false);
    expect((await getAssistantSettings()).instructions).toBe("Editado a mano");

    expect(await applyPreset(db, { ...preset, version: 2 })).toBe(true);
    expect((await getAssistantSettings()).instructions).toBe("Hablas de tú.");
  });

  it("conserva el estado de sincronización si la planilla no cambia", async () => {
    const synced = { sheetUrl: preset.inventorySheetUrl!, lastSyncAt: "2026-10-08T00:00:00.000Z", lastSyncRows: 37 };
    await setSetting("inventory", synced);
    await applyPreset(db, preset);
    expect(await getSetting("inventory", {})).toEqual(synced);
  });

  it("arma el funnel reutilizando las etapas existentes y sin perder leads", async () => {
    const nuevo = await db.stage.create({ data: { name: "Nuevo", position: 0 } });
    const extra = await db.stage.create({ data: { name: "Otra", position: 1 } });
    await applyPreset(db, {
      ...preset,
      stages: [
        { name: "Inicial", color: "#000000", replaces: ["Nuevo"] },
        { name: "Asistencia Humana", color: "#111111", requiresHuman: true },
      ],
      tags: [{ category: "Plazo", color: "#222222", names: ["Inmediato", "+6 meses"] }],
      stageRules: [{ name: "Regla humana", stage: "Asistencia Humana", strategy: "LEAST_LOADED" }],
    });

    const stages = await db.stage.findMany({ orderBy: { position: "asc" } });
    expect(stages.map((s) => [s.name, s.position, s.requiresHuman])).toEqual([
      ["Inicial", 0, false],
      ["Asistencia Humana", 1, true],
      ["Otra", 2, false],
    ]);
    expect(stages[0].id).toBe(nuevo.id);
    expect(stages[2].id).toBe(extra.id);
    expect(await db.tag.count({ where: { category: "Plazo" } })).toBe(2);
    const rule = await db.assignmentRule.findFirstOrThrow();
    expect([rule.name, rule.trigger, rule.stageId]).toEqual(["Regla humana", "STAGE_ENTERED", stages[1].id]);
  });

  it("aplica el preset completo de Compra Tu Parcela sobre el funnel de ejemplo", async () => {
    for (const [position, name] of ["Nuevo", "Calificado", "Interesado", "Atención humana"].entries()) {
      await db.stage.create({ data: { name, position, requiresHuman: name === "Atención humana" } });
    }
    await applyPreset(db, COMPRA_TU_PARCELA);
    const stages = await db.stage.findMany({ orderBy: { position: "asc" } });
    expect(stages.map((s) => s.name)).toEqual(COMPRA_TU_PARCELA.stages!.map((s) => s.name));
    const firstHuman = stages.find((s) => s.requiresHuman);
    expect(firstHuman?.name).toBe("Asistencia Humana");
    expect(await db.assignmentRule.count()).toBe(2);
  });

  it("la configuración de Compra Tu Parcela trae a Valentina y su inventario", () => {
    expect(COMPRA_TU_PARCELA.assistant.assistantName).toBe("Valentina");
    expect(COMPRA_TU_PARCELA.assistant.instructions).toContain("REGLA PRIORITARIA");
    expect(COMPRA_TU_PARCELA.assistant.instructions).not.toContain("Proyectos Vambe.xlsx");
    expect(COMPRA_TU_PARCELA.inventorySheetUrl).toContain("1tFAS2bIQXqG2dbzY6It390rG2NzVaGAze7w2a2a7eME");
  });
});
