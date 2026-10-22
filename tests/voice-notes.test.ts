import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { saveCredentials } from "@/lib/credentials";
import { createLead } from "@/lib/domain/leads";
import { setSetting } from "@/lib/settings";
import { runAgent } from "@/lib/ai/agent";
import type { AiConfig } from "@/lib/ai/config";
import type { ChatClient, ProviderClients } from "@/lib/ai/providers";
import { recordSpeechCost, type SpeechClient, type SpeechUsage } from "@/lib/ai/speech";
import { cloudApi } from "@/lib/channels/whatsapp";
import { DEFAULT_VOICE_NOTES, saveVoiceNoteSettings, shouldSpeak, speakable, type VoiceNoteSettings } from "@/lib/domain/voice-notes";
import { encodeOggOpus, mp3ToVoiceNote } from "@/lib/voice-note";
import { seedFunnel } from "./factories";

const MP3 = new Uint8Array(readFileSync(path.join(__dirname, "fixtures/voz.mp3")));

/** Páginas de un Ogg, comprobando la firma y el CRC de cada una. */
function oggPages(file: Uint8Array) {
  const buf = Buffer.from(file);
  const pages: { flags: number; granule: bigint; body: Buffer }[] = [];
  for (let at = 0; at < buf.length; ) {
    expect(buf.toString("ascii", at, at + 4)).toBe("OggS");
    const segments = buf[at + 26];
    const size = [...buf.subarray(at + 27, at + 27 + segments)].reduce((a, b) => a + b, 0);
    const end = at + 27 + segments + size;
    const page = Buffer.from(buf.subarray(at, end));
    const crc = page.readUInt32LE(22);
    page.writeUInt32LE(0, 22);
    let c = 0;
    for (const byte of page) {
      c ^= byte << 24;
      for (let j = 0; j < 8; j++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
      c >>>= 0;
    }
    expect(c).toBe(crc);
    pages.push({ flags: buf[at + 5], granule: buf.readBigInt64LE(at + 6), body: buf.subarray(at + 27 + segments, end) });
    at = end;
  }
  return pages;
}

describe("nota de voz Ogg/Opus", () => {
  it("arma un Ogg válido: OpusHead mono, OpusTags y fin de stream con la duración", () => {
    const second = new Float32Array(24_000).map((_, i) => 0.3 * Math.sin((2 * Math.PI * 440 * i) / 24_000));
    const pages = oggPages(encodeOggOpus(second, 24_000));
    expect(pages[0].body.toString("ascii", 0, 8)).toBe("OpusHead");
    expect(pages[0].body[9]).toBe(1);
    expect(pages[0].flags).toBe(0x02);
    expect(pages[1].body.toString("ascii", 0, 8)).toBe("OpusTags");
    const last = pages.at(-1)!;
    expect(last.flags).toBe(0x04);
    const preSkip = pages[0].body.readUInt16LE(10);
    expect(last.granule).toBe(BigInt(preSkip + 48_000));
  });

  it("convierte el MP3 del modelo de voz en una nota de voz liviana", async () => {
    const ogg = await mp3ToVoiceNote(MP3);
    const pages = oggPages(ogg);
    expect(pages[0].body.toString("ascii", 0, 8)).toBe("OpusHead");
    // ~1 segundo a 32 kbps: muy por debajo de los 512 KB de WhatsApp.
    expect(ogg.length).toBeLessThan(10_000);
  });
});

describe("cuándo la IA habla", () => {
  const on: VoiceNoteSettings = { ...DEFAULT_VOICE_NOTES, enabled: true };
  const audio = { mediaUrl: "https://blob/a.ogg", mediaType: "audio/ogg" };
  const text = { mediaUrl: null, mediaType: null };

  it("los links, correos, listas y respuestas largas van en texto", () => {
    expect(speakable("¡Claro! Te cuento cómo funciona.", 600)).toBe(true);
    expect(speakable("Mira https://ejemplo.cl", 600)).toBe(false);
    expect(speakable("Escríbenos a ventas@empresa.cl", 600)).toBe(false);
    expect(speakable("Tenemos:\n- Opción A\n- Opción B", 600)).toBe(false);
    expect(speakable("a".repeat(601), 600)).toBe(false);
  });

  it("apagado por defecto, solo en WhatsApp y el simulador, y según el modo", () => {
    expect(shouldSpeak(DEFAULT_VOICE_NOTES, "Hola", { channel: "WHATSAPP", lastFromContact: audio })).toBe(false);
    expect(shouldSpeak(on, "Hola", { channel: "WHATSAPP", lastFromContact: audio })).toBe(true);
    expect(shouldSpeak(on, "Hola", { channel: "WHATSAPP", lastFromContact: text })).toBe(false);
    expect(shouldSpeak(on, "Hola", { channel: "INSTAGRAM", lastFromContact: audio })).toBe(false);
    expect(shouldSpeak({ ...on, mode: "always" }, "Hola", { channel: "WHATSAPP", lastFromContact: text })).toBe(true);
    expect(shouldSpeak({ ...on, mode: "always" }, "Hola", { channel: "SIMULATOR", lastFromContact: null })).toBe(true);
  });
});

function fakeOpenRouter(reply: string): ChatClient {
  return { complete: async () => ({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: reply } }] }) };
}

function fakeVoice({ fail = false } = {}) {
  const spoken: string[] = [];
  const costs: SpeechUsage[] = [];
  const speak: SpeechClient = async (req) => {
    spoken.push(req.text);
    if (fail) throw new Error("OpenRouter 503");
    return { mp3: MP3, generationId: "gen-1" };
  };
  const voice: ProviderClients["voice"] = {
    speak,
    store: async (file, folder) => `https://blob.test/${folder}/${file.fileName}`,
    cost: async (usage) => {
      costs.push(usage);
    },
  };
  return { voice, spoken, costs };
}

describe("la IA responde con nota de voz", () => {
  async function leadWithMessage(fromContact: { body: string; audio?: boolean }) {
    await seedFunnel();
    await setSetting<AiConfig>("ai", { provider: "openrouter", model: "x/modelo", effort: "medium" });
    const lead = await createLead({ name: "Ana", channel: "SIMULATOR" });
    await db.message.create({
      data: {
        leadId: lead.id,
        author: "CONTACT",
        body: fromContact.audio ? "" : fromContact.body,
        ...(fromContact.audio ? { mediaUrl: "https://blob.test/c.ogg", mediaType: "audio/ogg", transcript: fromContact.body } : {}),
      },
    });
    return lead;
  }

  it("apagado por defecto: responde en texto y no genera audio", async () => {
    const lead = await leadWithMessage({ body: "hola", audio: true });
    const { voice, spoken } = fakeVoice();
    await runAgent(lead.id, { openrouter: fakeOpenRouter("¡Hola! ¿En qué te ayudo?"), voice });
    const reply = await db.message.findFirstOrThrow({ where: { leadId: lead.id, author: "AI" } });
    expect(reply).toMatchObject({ body: "¡Hola! ¿En qué te ayudo?", mediaUrl: null });
    expect(spoken).toEqual([]);
  });

  it("si el cliente mandó audio, responde con una nota de voz, guarda el texto como transcripción y suma el costo", async () => {
    await saveVoiceNoteSettings({ ...DEFAULT_VOICE_NOTES, enabled: true });
    const lead = await leadWithMessage({ body: "hola, ¿tienen parcelas?", audio: true });
    const { voice, spoken, costs } = fakeVoice();
    await runAgent(lead.id, { openrouter: fakeOpenRouter("¡Sí! Tenemos varias, ¿en qué zona buscas?"), voice });

    const reply = await db.message.findFirstOrThrow({ where: { leadId: lead.id, author: "AI" } });
    expect(reply).toMatchObject({
      body: "",
      transcript: "¡Sí! Tenemos varias, ¿en qué zona buscas?",
      mediaType: "audio/ogg",
      mediaUrl: `https://blob.test/leads/${lead.id}/nota-de-voz-ia.ogg`,
    });
    expect(spoken).toEqual(["¡Sí! Tenemos varias, ¿en qué zona buscas?"]);
    expect(costs).toMatchObject([{ model: DEFAULT_VOICE_NOTES.model, generationId: "gen-1" }]);

    // En el turno siguiente la IA sabe lo que dijo en su nota de voz.
    const requests: string[] = [];
    await db.message.create({ data: { leadId: lead.id, author: "CONTACT", body: "en el sur" } });
    await runAgent(lead.id, {
      openrouter: {
        complete: async (body) => {
          requests.push(JSON.stringify(body));
          return { choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Perfecto." } }] };
        },
      },
      voice,
    });
    expect(requests[0]).toContain("¡Sí! Tenemos varias");
  });

  it("si el cliente escribió, en el modo por defecto responde en texto", async () => {
    await saveVoiceNoteSettings({ ...DEFAULT_VOICE_NOTES, enabled: true });
    const lead = await leadWithMessage({ body: "hola" });
    const { voice, spoken } = fakeVoice();
    await runAgent(lead.id, { openrouter: fakeOpenRouter("¡Hola!"), voice });
    expect(spoken).toEqual([]);
    expect((await db.message.findFirstOrThrow({ where: { leadId: lead.id, author: "AI" } })).body).toBe("¡Hola!");
  });

  it("si el modelo de voz falla, la respuesta sale igual en texto", async () => {
    await saveVoiceNoteSettings({ ...DEFAULT_VOICE_NOTES, enabled: true, mode: "always" });
    const lead = await leadWithMessage({ body: "hola" });
    const { voice, spoken } = fakeVoice({ fail: true });
    await runAgent(lead.id, { openrouter: fakeOpenRouter("¡Hola!"), voice });
    expect(spoken).toEqual(["¡Hola!"]);
    expect(await db.message.findFirstOrThrow({ where: { leadId: lead.id, author: "AI" } })).toMatchObject({
      body: "¡Hola!",
      mediaUrl: null,
    });
  });
});

describe("envío por WhatsApp", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("un Ogg sale como nota de voz nativa (voice: true); otro audio, como archivo", async () => {
    await saveCredentials({ WHATSAPP_TOKEN: "token", WHATSAPP_PHONE_NUMBER_ID: "phone1" });
    const bodies: { audio: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 });
      }),
    );
    await cloudApi.sendAudio("56911112222", "https://x.blob.vercel-storage.com/leads/1/nota-de-voz-ia-abc.ogg");
    await cloudApi.sendAudio("56911112222", "https://x.blob.vercel-storage.com/leads/1/audio-abc.mp3");
    expect(bodies.map((b) => b.audio)).toEqual([
      { link: "https://x.blob.vercel-storage.com/leads/1/nota-de-voz-ia-abc.ogg", voice: true },
      { link: "https://x.blob.vercel-storage.com/leads/1/audio-abc.mp3" },
    ]);
  });
});

describe("consumo de la voz", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("suma al consumo de IA el costo que informa OpenRouter para la generación", async () => {
    await saveCredentials({ OPENROUTER_API_KEY: "sk-or-test" });
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return new Response(JSON.stringify({ data: { total_cost: 0.0042 } }), { status: 200 });
      }),
    );
    await recordSpeechCost({ model: "google/gemini-3.8-flash-tts", generationId: "gen-9", chars: 120, seconds: 8 });
    expect(urls).toEqual(["https://openrouter.ai/api/v1/generation?id=gen-9"]);
    expect(await db.aiUsage.findFirstOrThrow()).toMatchObject({ model: "google/gemini-3.8-flash-tts", cost: 0.0042 });
  });
});
