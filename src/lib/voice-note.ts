import OpusScript from "opusscript";

/**
 * Notas de voz para WhatsApp: WhatsApp solo las muestra como nota de voz (con la onda y el play)
 * si son Ogg con códec Opus. Los modelos de voz entregan MP3 o PCM, así que aquí se decodifica, se
 * codifica en Opus y se arma el contenedor Ogg (RFC 7845), todo en WebAssembly, sin ffmpeg.
 */

const OPUS_RATE = 48_000;
/** 20 ms por paquete, lo normal para voz. */
const FRAME = 960;
/** 32 kbps: buena voz y ~4 KB por segundo (WhatsApp muestra el play hasta 512 KB, ~2 minutos). */
const BITRATE = 32_000;
const OPUS_GET_LOOKAHEAD = 4027;

/** MP3 → muestras mono en [-1, 1] y su frecuencia. */
export async function decodeMp3(bytes: Uint8Array): Promise<{ samples: Float32Array; sampleRate: number }> {
  const { MPEGDecoder } = await import("mpg123-decoder");
  const decoder = new MPEGDecoder();
  await decoder.ready;
  try {
    const { channelData, samplesDecoded, sampleRate } = decoder.decode(bytes);
    if (!samplesDecoded || !channelData.length) throw new Error("El audio del modelo de voz venía vacío.");
    const samples = new Float32Array(samplesDecoded);
    for (const channel of channelData) {
      for (let i = 0; i < samplesDecoded; i++) samples[i] += channel[i] / channelData.length;
    }
    return { samples, sampleRate };
  } finally {
    decoder.free();
  }
}

/** Frecuencia del PCM crudo de los modelos de voz (Gemini, MAI-Voice): 24 kHz, 16 bits, mono. */
export const PCM_RATE = 24_000;

/**
 * PCM de 16 bits little-endian → muestras mono en [-1, 1]. Si viene con cabecera WAV se lee de
 * ella la frecuencia y los canales; si es crudo se asume `rate` mono.
 */
export function decodePcm(bytes: Uint8Array, rate = PCM_RATE): { samples: Float32Array; sampleRate: number } {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let data = buf;
  let sampleRate = rate;
  let channels = 1;
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WAVE") {
    for (let at = 12; at + 8 <= buf.length; ) {
      const id = buf.toString("ascii", at, at + 4);
      const size = buf.readUInt32LE(at + 4);
      if (id === "fmt ") {
        channels = buf.readUInt16LE(at + 10) || 1;
        sampleRate = buf.readUInt32LE(at + 12) || rate;
      } else if (id === "data") {
        data = buf.subarray(at + 8, Math.min(buf.length, at + 8 + size));
        break;
      }
      at += 8 + size + (size % 2);
    }
  }
  const frames = Math.floor(data.length / 2 / channels);
  if (!frames) throw new Error("El audio del modelo de voz venía vacío.");
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += data.readInt16LE((i * channels + c) * 2) / 0x8000;
    samples[i] = sum / channels;
  }
  return { samples, sampleRate };
}

/** Lleva las muestras a 48 kHz (interpolación lineal: de sobra para voz). */
export function resample(samples: Float32Array, from: number, to = OPUS_RATE): Float32Array {
  if (from === to) return samples;
  const out = new Float32Array(Math.round((samples.length * to) / from));
  const ratio = from / to;
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const j = Math.floor(pos);
    const a = samples[j] ?? 0;
    const b = samples[j + 1] ?? a;
    out[i] = a + (b - a) * (pos - j);
  }
  return out;
}

/** Muestras mono (cualquier frecuencia) → archivo Ogg/Opus. */
export function encodeOggOpus(samples: Float32Array, sampleRate: number): Uint8Array {
  const pcm = resample(samples, sampleRate);
  const encoder = new OpusScript(OPUS_RATE, 1, OpusScript.Application.VOIP);
  try {
    encoder.setBitrate(BITRATE);
    let preSkip = 312;
    try {
      // Algunas versiones devuelven el valor; si no, queda el habitual de libopus a 48 kHz.
      const lookahead = encoder.encoderCTL(OPUS_GET_LOOKAHEAD, 0) as unknown;
      if (typeof lookahead === "number" && lookahead > 0) preSkip = lookahead;
    } catch {
      // sin lookahead: se usa el habitual
    }
    const packets: Buffer[] = [];
    const frame = Buffer.alloc(FRAME * 2);
    for (let start = 0; start < pcm.length; start += FRAME) {
      frame.fill(0);
      for (let i = 0; i < FRAME && start + i < pcm.length; i++) {
        const s = Math.max(-1, Math.min(1, pcm[start + i]));
        frame.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), i * 2);
      }
      packets.push(Buffer.from(encoder.encode(frame, FRAME)));
    }
    return oggOpus(packets, preSkip, sampleRate, pcm.length);
  } finally {
    encoder.delete();
  }
}

/** MP3 del modelo de voz → nota de voz Ogg/Opus lista para WhatsApp. */
export async function mp3ToVoiceNote(mp3: Uint8Array): Promise<Uint8Array> {
  const { samples, sampleRate } = await decodeMp3(mp3);
  return encodeOggOpus(samples, sampleRate);
}

// --- Contenedor Ogg -------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    table[i] = r >>> 0;
  }
  return table;
})();

function oggCrc(data: Uint8Array): number {
  let crc = 0;
  for (const byte of data) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]) >>> 0;
  return crc;
}

const SERIAL = 0x42454c49; // "BELI"

function oggPage(packets: Uint8Array[], granule: bigint, seq: number, flags: number): Uint8Array {
  const lacing: number[] = [];
  for (const p of packets) {
    for (let n = p.length; ; n -= 255) {
      if (n < 255) {
        lacing.push(n);
        break;
      }
      lacing.push(255);
    }
  }
  const body = Buffer.concat(packets);
  const page = Buffer.alloc(27 + lacing.length + body.length);
  page.write("OggS", 0, "ascii");
  page.writeUInt8(0, 4);
  page.writeUInt8(flags, 5);
  page.writeBigInt64LE(granule, 6);
  page.writeUInt32LE(SERIAL, 14);
  page.writeUInt32LE(seq, 18);
  page.writeUInt8(lacing.length, 26);
  Buffer.from(lacing).copy(page, 27);
  body.copy(page, 27 + lacing.length);
  page.writeUInt32LE(oggCrc(page), 22);
  return page;
}

/** Arma el Ogg: cabecera OpusHead, OpusTags y los paquetes en páginas de hasta 255 segmentos. */
export function oggOpus(packets: Uint8Array[], preSkip: number, inputRate: number, totalSamples: number): Uint8Array {
  const head = Buffer.alloc(19);
  head.write("OpusHead", 0, "ascii");
  head.writeUInt8(1, 8); // versión
  head.writeUInt8(1, 9); // mono
  head.writeUInt16LE(preSkip, 10);
  head.writeUInt32LE(inputRate, 12);
  head.writeInt16LE(0, 16); // ganancia
  head.writeUInt8(0, 18); // mapeo de canales 0

  const vendor = Buffer.from("Beliapp", "utf8");
  const tags = Buffer.alloc(8 + 4 + vendor.length + 4);
  tags.write("OpusTags", 0, "ascii");
  tags.writeUInt32LE(vendor.length, 8);
  vendor.copy(tags, 12);
  tags.writeUInt32LE(0, 12 + vendor.length);

  const pages: Uint8Array[] = [oggPage([head], 0n, 0, 0x02), oggPage([tags], 0n, 1, 0)];
  const end = BigInt(preSkip + totalSamples);
  let seq = 2;
  let granule = BigInt(preSkip);
  let batch: Uint8Array[] = [];
  let segments = 0;
  const flush = (last: boolean) => {
    pages.push(oggPage(batch, last ? end : granule, seq++, last ? 0x04 : 0));
    batch = [];
    segments = 0;
  };
  packets.forEach((packet, i) => {
    const needed = Math.floor(packet.length / 255) + 1;
    if (segments + needed > 255) flush(false);
    batch.push(packet);
    segments += needed;
    granule += BigInt(FRAME);
    if (i === packets.length - 1) flush(true);
  });
  if (!packets.length) pages.push(oggPage([], end, seq, 0x04));
  return Buffer.concat(pages);
}
