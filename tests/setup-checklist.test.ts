import { describe, expect, it } from "vitest";
import { saveCredentials } from "@/lib/credentials";
import { db } from "@/lib/db";
import { setupChecklist } from "@/lib/domain/setup-checklist";
import { setSetting } from "@/lib/settings";
import { executive } from "./factories";

const done = async () => Object.fromEntries((await setupChecklist()).map((s) => [s.id, s.done]));

describe("Configura tu empresa", () => {
  it("marca solos los pasos a medida que se completan", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const before = await done();
    expect(before["ai-key"]).toBe(false);
    expect(before.knowledge).toBe(false);
    expect(before.team).toBe(false);
    expect(before.assistant).toBe(false);

    await saveCredentials({ OPENROUTER_API_KEY: "sk-or-test" });
    await db.knowledgeDoc.create({ data: { title: "Precios", content: "Parcelas desde $20 M" } });
    await executive("Ana");
    await executive("Beto");
    await setSetting("assistant", { assistantName: "Sofía", companyName: "Casas Sur", instructions: "Eres Sofía, de Casas Sur." });

    const after = await done();
    expect(after["ai-key"]).toBe(true);
    expect(after.knowledge).toBe(true);
    expect(after.team).toBe(true);
    expect(after.assistant).toBe(true);
  });
});
