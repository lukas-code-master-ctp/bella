import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createLead, DomainError } from "@/lib/domain/leads";
import { receiveContactAudio, sendUserAudio } from "@/lib/domain/messages";
import { setSetting } from "@/lib/settings";
import { runAgent } from "@/lib/ai/agent";
import type { AiConfig } from "@/lib/ai/config";
import type { ChatClient } from "@/lib/ai/providers";
import { DEFAULT_TRANSCRIPTION_MODEL, openRouterTranscriber } from "@/lib/ai/transcribe";
import { AUDIO_MAX_BYTES, audioFormat, type AudioFile, type MediaStore } from "@/lib/media";
import { encodeWav } from "@/lib/wav";
import { seedFunnel } from "./factories";

const voiceNote = (bytes = new Uint8Array([1, 2, 3])): AudioFile => ({
  bytes,
  mimeType: "audio/ogg; codecs=opus",
  fileName: "nota de voz.ogg",
});

const store: MediaStore = async (file, folder) => `https://blob.test/${folder}/${file.fileName}`;

/** OpenRouter falso: registra las solicitudes y responde siempre lo mismo. */
function fakeChat(reply: string) {
  const requests: Record<string, unknown>[] = [];
  const client: ChatClient = {
    complete: async (body) => {
      requests.push(structuredClone(body));
      return { choices: [{ finish_reason: "stop", message: { role: "assistant", content: reply } }] };
    },
  };
  return { client, requests };
}

describe("notas de voz del cliente", () => {
  beforeEach(() => setSetting<AiConfig>("ai", { provider: "openrouter", model: "modelo-x", effort: "medium" }));

  it("guarda el audio con su transcripción y la IA responde a lo que dijo", async () => {
    await seedFunnel();
    const lead = await createLead({ name: "Pedro", channel: "SIMULATOR" });
    await receiveContactAudio(lead.id, voiceNote(), { store, transcribe: async () => "Hola, ¿tienen parcelas en Pucón?" });

    const saved = await db.message.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(saved).toMatchObject({
      author: "CONTACT",
      body: "",
      mediaUrl: `https://blob.test/leads/${lead.id}/nota de voz.ogg`,
      mediaType: "audio/ogg; codecs=opus",
      transcript: "Hola, ¿tienen parcelas en Pucón?",
    });

    const agent = fakeChat("¡Sí! Tenemos varias en Pucón.");
    await runAgent(lead.id, { openrouter: agent.client });
    const turn = JSON.stringify((agent.requests[0].messages as unknown[]).at(-1));
    expect(turn).toContain("Cliente (nota de voz, transcrita): Hola, ¿tienen parcelas en Pucón?");
    const last = await db.message.findFirstOrThrow({ where: { leadId: lead.id }, orderBy: { createdAt: "desc" } });
    expect(last).toMatchObject({ author: "AI", body: "¡Sí! Tenemos varias en Pucón." });
  });

  it("si la transcripción falla, el audio queda y la IA sabe que no lo pudo escuchar", async () => {
    await seedFunnel();
    const lead = await createLead({ name: "Pedro", channel: "SIMULATOR" });
    await receiveContactAudio(lead.id, voiceNote(), {
      store,
      transcribe: async () => {
        throw new Error("OpenRouter 500");
      },
    });

    const saved = await db.message.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(saved.mediaUrl).toBeTruthy();
    expect(saved.transcript).toBeNull();

    const agent = fakeChat("No pude escuchar tu audio, ¿me lo escribes?");
    await runAgent(lead.id, { openrouter: agent.client });
    expect(JSON.stringify(agent.requests[0].messages)).toContain("nota de voz que no se pudo transcribir");
  });

  it("rechaza audios vacíos, muy pesados o que no son audio, sin guardar nada", async () => {
    await seedFunnel();
    const lead = await createLead({ name: "Pedro", channel: "SIMULATOR" });
    const deps = { store, transcribe: async () => "x" };
    await expect(receiveContactAudio(lead.id, voiceNote(new Uint8Array()), deps)).rejects.toThrow(DomainError);
    await expect(
      receiveContactAudio(lead.id, voiceNote(new Uint8Array(AUDIO_MAX_BYTES + 1)), deps),
    ).rejects.toThrow(DomainError);
    await expect(
      receiveContactAudio(lead.id, { ...voiceNote(), mimeType: "application/pdf", fileName: "a.pdf" }, deps),
    ).rejects.toThrow(DomainError);
    expect(await db.message.count()).toBe(0);
  });
});

describe("notas de voz del ejecutivo", () => {
  beforeEach(() => setSetting<AiConfig>("ai", { provider: "openrouter", model: "modelo-x", effort: "medium" }));

  it("guarda la nota de voz grabada con su autor y la IA la lee transcrita", async () => {
    await seedFunnel();
    const user = await db.user.create({ data: { email: "eje@test.cl", name: "Tiare", passwordHash: "x" } });
    const lead = await createLead({ name: "Pedro", channel: "SIMULATOR" });
    const file = { bytes: new Uint8Array([1, 2]), mimeType: "audio/mp4", fileName: "nota-de-voz.m4a" };
    await sendUserAudio(lead.id, user.id, file, { store, transcribe: async () => "Te llamo a las cinco" });

    const saved = await db.message.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(saved).toMatchObject({
      author: "USER",
      userId: user.id,
      body: "",
      mediaUrl: `https://blob.test/leads/${lead.id}/nota-de-voz.m4a`,
      transcript: "Te llamo a las cinco",
    });

    await receiveContactAudio(lead.id, voiceNote(), { store, transcribe: async () => "Perfecto, gracias" });
    const agent = fakeChat("¡Quedamos atentos!");
    await runAgent(lead.id, { openrouter: agent.client });
    expect(JSON.stringify(agent.requests[0].messages)).toContain("Ejecutivo (Tiare), nota de voz: Te llamo a las cinco");
  });
});

describe("nota de voz del ejecutivo por WhatsApp", () => {
  beforeEach(() => seedFunnel());

  it("convierte la grabación WAV a Ogg/Opus y transcribe el WAV original", async () => {
    const user = await db.user.create({ data: { email: "eje@test.cl", name: "Tiare", passwordHash: "x" } });
    const lead = await createLead({ name: "William", channel: "WHATSAPP", externalId: "56900000000" });
    const tone = new Float32Array(16_000).map((_, i) => 0.3 * Math.sin((2 * Math.PI * 440 * i) / 16_000));
    const wav = { bytes: new Uint8Array(encodeWav(tone)), mimeType: "audio/wav", fileName: "nota-de-voz-1.wav" };
    const stored: AudioFile[] = [];
    let transcribed: AudioFile | null = null;
    await sendUserAudio(lead.id, user.id, wav, {
      store: async (file, folder) => (stored.push(file), `https://blob.test/${folder}/${file.fileName}`),
      transcribe: async (file) => ((transcribed = file), "Hola William"),
    });

    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ mimeType: "audio/ogg", fileName: "nota-de-voz-1.ogg" });
    expect(Buffer.from(stored[0].bytes.subarray(0, 4)).toString("ascii")).toBe("OggS");
    expect(transcribed).toBe(wav);
    const saved = await db.message.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(saved).toMatchObject({ mediaType: "audio/ogg", transcript: "Hola William" });
  });

  it("en el simulador guarda el WAV tal cual", async () => {
    const user = await db.user.create({ data: { email: "eje@test.cl", name: "Tiare", passwordHash: "x" } });
    const lead = await createLead({ name: "William", channel: "SIMULATOR" });
    const wav = { bytes: new Uint8Array(encodeWav(new Float32Array(1600).fill(0.2))), mimeType: "audio/wav", fileName: "n.wav" };
    await sendUserAudio(lead.id, user.id, wav, { store, transcribe: async () => "" });
    expect(await db.message.findFirstOrThrow({ where: { leadId: lead.id } })).toMatchObject({ mediaType: "audio/wav" });
  });
});

describe("transcripción con OpenRouter", () => {
  it("manda el audio en base64 con su formato y devuelve el texto", async () => {
    const { client, requests } = fakeChat("  Quiero agendar una visita  ");
    const text = await openRouterTranscriber(client)(voiceNote(new Uint8Array([104, 111, 108, 97])));

    expect(text).toBe("Quiero agendar una visita");
    expect(requests[0].model).toBe(process.env.TRANSCRIPTION_MODEL || DEFAULT_TRANSCRIPTION_MODEL);
    const content = (requests[0].messages as { content: { type: string }[] }[])[0].content;
    expect(content[1]).toEqual({ type: "input_audio", input_audio: { data: "aG9sYQ==", format: "ogg" } });
  });

  it("reconoce el formato por tipo MIME o por extensión", () => {
    expect(audioFormat("audio/mpeg", "x")).toBe("mp3");
    expect(audioFormat("", "nota.opus")).toBe("ogg");
    expect(audioFormat("audio/x-m4a", "nota.m4a")).toBe("m4a");
    expect(audioFormat("application/octet-stream", "nota.txt")).toBeNull();
  });
});
