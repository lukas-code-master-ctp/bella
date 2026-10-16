import { describe, expect, it } from "vitest";
import { isStaleDeployError } from "@/components/error-screen";

describe("isStaleDeployError", () => {
  it("reconoce errores de una pestaña con la versión anterior", () => {
    expect(isStaleDeployError(new TypeError("e[o] is not a function"))).toBe(true);
    expect(isStaleDeployError(new TypeError("Cannot read properties of undefined (reading 'call')"))).toBe(true);
    const chunk = new Error("Loading chunk 123 failed.");
    chunk.name = "ChunkLoadError";
    expect(isStaleDeployError(chunk)).toBe(true);
  });

  it("no confunde otros errores", () => {
    expect(isStaleDeployError(new TypeError("lead.name.trim is not a function"))).toBe(false);
    expect(isStaleDeployError(new Error("No autorizado"))).toBe(false);
  });
});
