import { describe, expect, it } from "vitest";
import { encodeWav, mergeAndResample, peakLevel } from "@/lib/wav";

describe("notas de voz en WAV", () => {
  it("arma un WAV PCM mono de 16 bits con su encabezado", () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 0.5]), 16_000);
    const view = new DataView(wav.buffer);
    const text = (at: number, n: number) => String.fromCharCode(...wav.slice(at, at + n));
    expect(text(0, 4)).toBe("RIFF");
    expect(text(8, 4)).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(40, true)).toBe(8);
    expect([0, 1, 2, 3].map((i) => view.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32768, 16383]);
  });

  it("junta los trozos y baja la frecuencia de muestreo", () => {
    const out = mergeAndResample([new Float32Array(48_000).fill(0.2), new Float32Array(48_000).fill(0.4)], 48_000);
    expect(out.length).toBe(32_000);
    expect(out[0]).toBeCloseTo(0.2);
    expect(out[31_999]).toBeCloseTo(0.4);
  });

  it("mide el volumen máximo para detectar grabaciones en silencio", () => {
    expect(peakLevel(new Float32Array([0, -0.3, 0.1]))).toBeCloseTo(0.3);
    expect(peakLevel(new Float32Array(100))).toBe(0);
  });
});
