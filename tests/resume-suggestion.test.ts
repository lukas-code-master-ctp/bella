import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createLead } from "@/lib/domain/leads";
import { setSetting } from "@/lib/settings";
import { suggestResume } from "@/lib/ai/resume-suggestion";
import type { AiConfig } from "@/lib/ai/config";
import type { ChatClient } from "@/lib/ai/providers";
import { seedFunnel } from "./factories";

function fakeOpenRouter(replies: string[]) {
  const requests: { model: string; messages: { role: string; content: string }[] }[] = [];
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

const now = new Date("2026-10-26T15:00:00Z");

describe("sugerir cuándo retomar (No requiere respuesta)", () => {
  it("lee la conversación y devuelve la fecha y la nota que sugiere la IA", async () => {
    await setSetting<AiConfig>("ai", { provider: "openrouter", model: "grande", effort: "high", summaryModel: "chico" });
    await seedFunnel();
    const lead = await createLead({ name: "Juan", channel: "WHATSAPP" });
    await db.message.create({ data: { leadId: lead.id, author: "CONTACT", body: "Me gustaría visitar en diciembre", createdAt: now } });
    const { clients, requests } = fakeOpenRouter(['```json\n{"fecha": "2026-11-27", "nota": "Quiere visitar en diciembre."}\n```']);

    expect(await suggestResume(lead.id, { now, clients })).toEqual({ date: "2026-11-27", note: "Quiere visitar en diciembre." });
    expect(requests[0].model).toBe("chico");
    const input = requests[0].messages[1].content;
    expect(input).toContain("<hoy>2026-10-26</hoy>");
    expect(input).toContain("Cliente (2026-10-26): Me gustaría visitar en diciembre");
  });

  it("descarta fechas pasadas o mal escritas", async () => {
    await setSetting<AiConfig>("ai", { provider: "openrouter", model: "grande", effort: "high", summaryModel: "chico" });
    await seedFunnel();
    const lead = await createLead({ name: "Juan", channel: "WHATSAPP" });
    await db.message.create({ data: { leadId: lead.id, author: "CONTACT", body: "Gracias, saludos", createdAt: now } });
    const { clients } = fakeOpenRouter(['{"fecha": "2026-10-01", "nota": "Se despidió."}', '{"fecha": "diciembre", "nota": 3}']);

    expect(await suggestResume(lead.id, { now, clients })).toEqual({ date: null, note: "Se despidió." });
    expect(await suggestResume(lead.id, { now, clients })).toEqual({ date: null, note: "" });
  });
});
