import { describe, expect, it } from "vitest";
import { timeline } from "@/lib/chat-timeline";

const msg = (id: string, at?: number, pending = false) => ({ id, at, pending });
const ev = (id: string, at: number) => ({ id, at });

describe("timeline", () => {
  it("intercala eventos entre mensajes por hora", () => {
    const out = timeline([msg("m1", 10), msg("m2", 30)], [ev("e0", 5), ev("e1", 20), ev("e2", 40)]);
    expect(out.map((x) => x.id)).toEqual(["e0", "m1", "e1", "m2", "e2"]);
  });

  it("con la misma hora pone el mensaje antes y deja los optimistas al final", () => {
    const out = timeline([msg("m1", 10), msg("p", undefined, true)], [ev("e1", 10)]);
    expect(out.map((x) => x.id)).toEqual(["m1", "e1", "p"]);
  });

  it("sin mensajes muestra solo los eventos", () => {
    expect(timeline([], [ev("e1", 1)]).map((x) => x.id)).toEqual(["e1"]);
  });
});
