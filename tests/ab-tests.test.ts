import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { buildSystemPrompt } from "@/lib/ai/agent";
import { applyVariant, createVariant, deleteVariant, pickVariant, updateVariant, variantStats } from "@/lib/domain/ab-tests";
import { closeLead, createLead } from "@/lib/domain/leads";
import { DEFAULT_ASSISTANT } from "@/lib/settings";
import { seedFunnel } from "./factories";

const variant = (name: string, weight: number, instructions = "", channel: "WHATSAPP" | "INSTAGRAM" = "WHATSAPP") =>
  createVariant({ name, channel, assistantName: "", instructions, weight, active: true });

describe("pruebas A/B de la asistente", () => {
  it("sin variantes, los leads no reciben ninguna", async () => {
    await seedFunnel();
    const lead = await createLead({ name: "Ana", channel: "WHATSAPP", externalId: "1" });
    expect(lead.variantId).toBeNull();
  });

  it("reparte según el peso, solo entre las activas del canal", async () => {
    await seedFunnel();
    const a = await variant("Control", 50);
    const b = await variant("Directa", 50);
    await variant("De Instagram", 50, "", "INSTAGRAM");
    expect(await pickVariant(db, "WHATSAPP", () => 0.1)).toBe(a.id);
    expect(await pickVariant(db, "WHATSAPP", () => 0.9)).toBe(b.id);
    await updateVariant(b.id, { name: "Directa", assistantName: "", instructions: "", weight: 50, active: false });
    expect(await pickVariant(db, "WHATSAPP", () => 0.9)).toBe(a.id);
    expect(await pickVariant(db, "FACEBOOK")).toBeNull();

    const lead = await createLead({ name: "Ana", channel: "WHATSAPP", externalId: "1" });
    expect(lead.variantId).toBe(a.id);
  });

  it("la variante cambia el nombre y suma sus instrucciones", async () => {
    const v = await createVariant({
      name: "Sofía",
      channel: "WHATSAPP",
      assistantName: "Sofía",
      instructions: "Ofrece agendar una visita.",
      weight: 50,
      active: true,
    });
    const prompt = buildSystemPrompt(applyVariant(DEFAULT_ASSISTANT, v));
    expect(prompt).toContain("Eres Sofía");
    expect(prompt).toContain("Ofrece agendar una visita.");
    expect(applyVariant(DEFAULT_ASSISTANT, null)).toEqual(DEFAULT_ASSISTANT);
  });

  it("muestra los resultados por variante y no borra una con leads", async () => {
    await seedFunnel();
    const a = await variant("Control", 100);
    const won = await createLead({ name: "Ana", channel: "WHATSAPP", externalId: "1" });
    const lost = await createLead({ name: "Beto", channel: "WHATSAPP", externalId: "2" });
    await createLead({ name: "Caro", channel: "WHATSAPP", externalId: "3" });
    await closeLead(won.id, "WON", { actor: "USER" }, {});
    await closeLead(lost.id, "LOST", { actor: "USER" }, { lostReason: "Precio" });
    const [stats] = await variantStats();
    expect(stats).toMatchObject({ leads: 3, open: 1, won: 1, lost: 1, winRate: 0.5 });
    await expect(deleteVariant(a.id)).rejects.toThrow(/pausa la variante/);
    const empty = await variant("Vacía", 0);
    await deleteVariant(empty.id);
    expect(await db.assistantVariant.count()).toBe(1);
  });

  it("valida el nombre y el peso", async () => {
    await expect(variant("", 50)).rejects.toThrow(/nombre/);
    await expect(variant("X", 150)).rejects.toThrow(/peso/);
  });
});
