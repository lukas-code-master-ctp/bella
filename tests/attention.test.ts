import { describe, expect, it } from "vitest";
import { AI_GRACE_MS, attentionOf } from "@/lib/domain/attention";

const now = new Date("2026-10-10T15:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

describe("estado de atención del lead", () => {
  it("con la IA activa y sin mensajes pendientes, lo atiende la IA", () => {
    expect(attentionOf({ aiEnabled: true, requiresHuman: false, lastMessage: null }, now)).toBe("ai");
    expect(attentionOf({ aiEnabled: true, requiresHuman: false, lastMessage: { author: "AI", createdAt: ago(60_000) } }, now)).toBe("ai");
  });

  it("con la IA pausada o en una etapa humana, lo atiende un ejecutivo", () => {
    expect(attentionOf({ aiEnabled: false, requiresHuman: false, lastMessage: { author: "USER", createdAt: ago(1) } }, now)).toBe("human");
    expect(attentionOf({ aiEnabled: true, requiresHuman: true, lastMessage: null }, now)).toBe("human");
  });

  it("si el cliente escribió y lo atiende un humano, queda sin atender de inmediato", () => {
    expect(attentionOf({ aiEnabled: false, requiresHuman: false, lastMessage: { author: "CONTACT", createdAt: ago(1000) } }, now)).toBe("waiting");
    expect(attentionOf({ aiEnabled: true, requiresHuman: true, lastMessage: { author: "CONTACT", createdAt: ago(1000) } }, now)).toBe("waiting");
  });

  it("si responde la IA, solo queda sin atender cuando lleva un rato sin respuesta", () => {
    const fresh = { author: "CONTACT" as const, createdAt: ago(30_000) };
    const stale = { author: "CONTACT" as const, createdAt: ago(AI_GRACE_MS + 1000) };
    expect(attentionOf({ aiEnabled: true, requiresHuman: false, lastMessage: fresh }, now)).toBe("ai");
    expect(attentionOf({ aiEnabled: true, requiresHuman: false, lastMessage: stale }, now)).toBe("waiting");
  });
});
