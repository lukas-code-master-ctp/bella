import { describe, expect, it } from "vitest";
import { setSetting } from "@/lib/settings";
import { polishTemplateText } from "@/lib/ai/polish-template";
import type { AiConfig } from "@/lib/ai/config";
import type { ChatClient } from "@/lib/ai/providers";

function fakeOpenRouter(replies: string[]) {
  const requests: { messages: { role: string; content: string }[] }[] = [];
  const client: ChatClient = {
    async complete(body) {
      requests.push(structuredClone(body) as (typeof requests)[number]);
      const content = replies.shift();
      if (content === undefined) throw new Error("Sin respuestas guionadas");
      return { model: "x", choices: [{ finish_reason: "stop", message: { role: "assistant", content } }] };
    },
  };
  return { clients: { openrouter: client }, requests };
}

describe("pulir plantilla", () => {
  it("devuelve el texto pulido con las mismas variables", async () => {
    await setSetting<AiConfig>("ai", { provider: "openrouter", model: "grande", effort: "high", summaryModel: "chico" });
    const { clients, requests } = fakeOpenRouter(['"¡Hola {{1}}! Tenemos novedades para ti. ¿Te cuento más?"']);
    const text = await polishTemplateText("hola {{1}} tenemos novedades", "MARKETING", { clients });
    expect(text).toBe("¡Hola {{1}}! Tenemos novedades para ti. ¿Te cuento más?");
    expect(requests[0].messages[1].content).toBe("hola {{1}} tenemos novedades");
  });

  it("reintenta si la IA cambia las variables y avisa si no lo logra", async () => {
    await setSetting<AiConfig>("ai", { provider: "openrouter", model: "grande", effort: "high", summaryModel: "chico" });
    const ok = fakeOpenRouter(["Hola, novedades para ti.", "Hola {{1}}, hay novedades para ti."]);
    expect(await polishTemplateText("hola {{1}} hay novedades", "MARKETING", ok)).toBe("Hola {{1}}, hay novedades para ti.");
    const bad = fakeOpenRouter(["Hola {{1}} y {{2}}.", "{{1}}, hola"]);
    await expect(polishTemplateText("hola {{1}} hay novedades", "MARKETING", bad)).rejects.toThrow(/variables/);
  });

  it("pide escribir algo antes de pulir", async () => {
    await expect(polishTemplateText("Hola {{1}}, ", "MARKETING")).rejects.toThrow(/Escribe primero/);
  });
});
