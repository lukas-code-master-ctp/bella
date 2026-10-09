/**
 * Notas de voz en WAV: se arma el archivo a partir del audio crudo del micrófono, sin depender
 * del codificador del navegador (en Chrome el AAC de MediaRecorder llegó a grabar silencio).
 * WAV lo entienden la transcripción y todos los navegadores.
 */

/** 16 kHz mono de 16 bits: de sobra para voz y ~32 KB por segundo. */
export const WAV_SAMPLE_RATE = 16_000;

/** Junta los trozos grabados y los lleva a `targetRate` promediando las muestras de cada tramo. */
export function mergeAndResample(chunks: Float32Array[], sourceRate: number, targetRate = WAV_SAMPLE_RATE) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  if (sourceRate <= targetRate) return merged;
  const ratio = sourceRate / targetRate;
  const out = new Float32Array(Math.floor(total / ratio));
  for (let i = 0; i < out.length; i++) {
    const from = Math.floor(i * ratio);
    const to = Math.min(total, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = from; j < to; j++) sum += merged[j];
    out[i] = sum / Math.max(1, to - from);
  }
  return out;
}

/** Volumen máximo (0 a 1). Sirve para avisar cuando el micrófono no captó nada. */
export function peakLevel(samples: Float32Array) {
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  return peak;
}

/** Archivo WAV PCM de 16 bits, mono. */
export function encodeWav(samples: Float32Array, sampleRate = WAV_SAMPLE_RATE) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (at: number, s: string) => [...s].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true); // tamaño del bloque fmt
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // bytes por segundo
  view.setUint16(32, 2, true); // bytes por muestra
  view.setUint16(34, 16, true); // bits por muestra
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => {
    const v = Math.max(-1, Math.min(1, s));
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  });
  return new Uint8Array(buffer);
}
