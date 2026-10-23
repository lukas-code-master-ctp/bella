import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createLead } from "@/lib/domain/leads";
import { setSetting } from "@/lib/settings";
import { draftExecutiveReply } from "@/lib/ai/draft-reply";
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

describe("redactar con IA (@ia)", () => {
  it("redacta con la conversación, el conocimiento y el pedido del ejecutivo, sin tocar el historial de la IA", async () => {
    await setSetting<AiConfig>("ai", { provider: "openrouter", model: "grande", effort: "high", summaryModel: "chico" });
    await seedFunnel();
    const lead = await createLead({ name: "Ana", channel: "SIMULATOR" });
    await db.message.create({ data: { leadId: lead.id, author: "CONTACT", body: "Hola, ¿tienen visitas el fin de semana?" } });
    await db.knowledgeDoc.create({ data: { title: "Visitas", content: "Visitas guiadas los sábados a las 11:00." } });
    const { clients, requests } = fakeOpenRouter(['"¡Hola Ana! Sí, el sábado a las 11:00 hay visita guiada. ¿Te anoto?"']);

    const draft = await draftExecutiveReply(lead.id, "Pedro", "ofrécele el sábado", { clients });

    expect(draft).toBe("¡Hola Ana! Sí, el sábado a las 11:00 hay visita guiada. ¿Te anoto?");
    expect(requests[0].model).toBe("chico");
    const [system, input] = requests[0].messages.map((m) => m.content);
    expect(system).toContain("Pedro, ejecutivo de ventas");
    expect(system).toContain("Visitas guiadas los sábados");
    expect(input).toContain("Cliente: Hola, ¿tienen visitas el fin de semana?");
    expect(input).toContain("<pedido_del_ejecutivo>\nofrécele el sábado");
    // Es un borrador: no se guarda ningún mensaje ni se toca el historial de la asistente.
    expect(await db.message.count({ where: { leadId: lead.id } })).toBe(1);
    expect(await db.agentTranscript.count()).toBe(0);
  });

  it("sin conversación pide una indicación", async () => {
    await seedFunnel();
    const lead = await createLead({ name: "Ana", channel: "SIMULATOR" });
    await expect(draftExecutiveReply(lead.id, "Pedro", "  ", fakeOpenRouter([]))).rejects.toThrow('después de "@ia"');
  });
});
