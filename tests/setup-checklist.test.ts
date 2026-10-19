import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { setupChecklist } from "@/lib/domain/setup-checklist";
import { setSetting } from "@/lib/settings";
import { executive } from "./factories";

const done = async () => Object.fromEntries((await setupChecklist()).map((s) => [s.id, s.done]));

describe("Configura tu empresa", () => {
  it("marca solos los pasos a medida que se completan", async () => {
    const before = await done();
    expect(before.knowledge).toBe(false);
    expect(before.team).toBe(false);
    expect(before.assistant).toBe(false);

    await db.knowledgeDoc.create({ data: { title: "Precios", content: "Parcelas desde $20 M" } });
    await executive("Ana");
    await executive("Beto");
    await setSetting("assistant", { assistantName: "Sofía", companyName: "Casas Sur", instructions: "Eres Sofía, de Casas Sur." });

    const after = await done();
    expect(after.knowledge).toBe(true);
    expect(after.team).toBe(true);
    expect(after.assistant).toBe(true);
  });
});
