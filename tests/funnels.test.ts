import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { executeTool } from "@/lib/ai/tools";
import { buildSystemPrompt } from "@/lib/ai/agent";
import { assistantFor, createFunnel, deleteFunnel, DEFAULT_FUNNEL_ID, stageOptions, updateFunnel } from "@/lib/domain/funnels";
import { createLead, handoffToHumanTx } from "@/lib/domain/leads";
import { DEFAULT_ASSISTANT } from "@/lib/settings";
import { importContactsCsv } from "@/lib/domain/contact-import";
import { seedFunnel } from "./factories";

async function onlineFunnel(channels: ("WHATSAPP" | "INSTAGRAM")[] = []) {
  const f = await createFunnel("Venta online");
  await updateFunnel(f.id, { name: "Venta online", channels, assistantName: "Sofía", instructions: "Vendemos cursos." });
  const nuevo = await db.stage.create({ data: { funnelId: f.id, name: "Nuevo", position: 0 } });
  const humano = await db.stage.create({ data: { funnelId: f.id, name: "Asesor", position: 1, requiresHuman: true } });
  return { funnel: await db.funnel.findUniqueOrThrow({ where: { id: f.id } }), nuevo, humano };
}

describe("varios embudos", () => {
  it("el lead nuevo entra al embudo de su canal; sin canal asignado, al primero", async () => {
    const principal = await seedFunnel();
    const { funnel, nuevo } = await onlineFunnel(["WHATSAPP"]);
    const wa = await createLead({ name: "Ana", channel: "WHATSAPP", externalId: "569" });
    const ig = await createLead({ name: "Beto", channel: "INSTAGRAM", externalId: "ig" });
    const sim = await createLead({ name: "Prueba", channel: "SIMULATOR" }, { funnelId: funnel.id });
    expect(wa.stageId).toBe(nuevo.id);
    expect(ig.stageId).toBe(principal[0].id);
    expect(sim.stageId).toBe(nuevo.id);
  });

  it("un canal queda en un solo embudo", async () => {
    await seedFunnel();
    await updateFunnel(DEFAULT_FUNNEL_ID, { name: "Principal", channels: ["WHATSAPP", "INSTAGRAM"], assistantName: "", instructions: "" });
    await onlineFunnel(["WHATSAPP"]);
    expect((await db.funnel.findUniqueOrThrow({ where: { id: DEFAULT_FUNNEL_ID } })).channels).toEqual(["INSTAGRAM"]);
  });

  it("la IA solo mueve y deriva dentro del embudo del lead", async () => {
    await seedFunnel();
    const { funnel, humano } = await onlineFunnel();
    const lead = await createLead({ name: "Ana", channel: "SIMULATOR" }, { funnelId: funnel.id });
    // "Calificado" existe solo en el embudo principal.
    expect(await executeTool(lead.id, "move_stage", { stage: "Calificado", reason: "x" })).toMatchObject({ isError: true });
    await db.$transaction((tx) => handoffToHumanTx(tx, lead.id, "pidió un asesor"));
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).stageId).toBe(humano.id);
  });

  it("cada embudo puede tener su asistente", async () => {
    const { funnel } = await onlineFunnel();
    const prompt = buildSystemPrompt(assistantFor(DEFAULT_ASSISTANT, funnel));
    expect(prompt).toContain("Eres Sofía");
    expect(prompt).toContain("Vendemos cursos.");
    expect(assistantFor(DEFAULT_ASSISTANT, { assistantName: null, instructions: null })).toEqual(DEFAULT_ASSISTANT);
  });

  it("las etapas se muestran con su embudo y el import elige el embudo", async () => {
    await seedFunnel();
    const { nuevo } = await onlineFunnel();
    expect((await stageOptions()).map((s) => s.label)).toContain("Venta online · Nuevo");
    await importContactsCsv("Nombre,Teléfono,Embudo,Etapa\nAna,+56911112222,Venta online,Nuevo", { actor: "USER" });
    expect((await db.lead.findFirstOrThrow()).stageId).toBe(nuevo.id);
  });

  it("no borra un embudo con leads ni el original", async () => {
    await seedFunnel();
    const { funnel } = await onlineFunnel();
    await createLead({ name: "Ana", channel: "SIMULATOR" }, { funnelId: funnel.id });
    await expect(deleteFunnel(funnel.id)).rejects.toThrow(/tiene leads/);
    await expect(deleteFunnel(DEFAULT_FUNNEL_ID)).rejects.toThrow(/no se puede borrar/);
  });
});
