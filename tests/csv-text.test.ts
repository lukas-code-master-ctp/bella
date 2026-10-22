import { describe, expect, it } from "vitest";
import { decodeCsv } from "@/lib/csv-text";

describe("decodeCsv", () => {
  it("lee UTF-8 y quita el BOM", () => {
    const bytes = new TextEncoder().encode("﻿nombre\nElizabeth Pérez");
    expect(decodeCsv(bytes)).toBe("nombre\nElizabeth Pérez");
  });

  it("lee CSV de Excel en Windows-1252", () => {
    // "Elizabeth Pérez" con é = 0xE9 (Latin-1)
    const bytes = Uint8Array.from([..."nombre\nElizabeth P"].map((c) => c.charCodeAt(0)).concat(0xe9, ..."rez".split("").map((c) => c.charCodeAt(0))));
    expect(decodeCsv(bytes)).toBe("nombre\nElizabeth Pérez");
  });
});
