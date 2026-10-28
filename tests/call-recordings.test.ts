import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { parseCallSummary, type summarizeCall } from "@/lib/ai/call-summary";
import { toLocalInput } from "@/lib/dates";
import {
  analyzeCall,
  callLines,
  canUploadRecording,
  createProposedTask,
  dismissProposedTask,
  proposedDueAt,
  resumeStuckAnalyses,
  retryCallAnalysis,
  saveCallRecording,
  type ProposedTask,
  type RecordingDeps,
} from "@/lib/domain/call-recordings";
import { getCallSettings, saveCallSettings } from "@/lib/domain/calls";
import { createLead } from "@/lib/domain/leads";
import { setSetting } from "@/lib/settings";
import { executive, seedFunnel } from "./factories";

const URL_OK = (callId: string) => `https://abc.public.blob.vercel-storage.com/calls/${callId}/llamada-x1y2.webm`;

async function answeredCall() {
  const luis = await executive("Luis");
  const lead = await createLead({ name: "Ana Pérez", channel: "SIMULATOR" });
  const call = await db.call.create({
    data: {
      leadId: lead.id,
      externalId: "wacid.1",
      phoneNumberId: "123",
      status: "ENDED",
      answeredById: luis.id,
      answeredAt: new Date("2026-10-28T13:37:00Z"),
      endedAt: new Date("2026-10-28T13:38:07Z"),
      durationSec: 67,
    },
  });
  return { luis, lead, call };
}

const summary: typeof summarizeCall = async () => ({
  summary: "Ana busca una parcela en Pucón, presupuesto de 40 millones. Quedó de ir a verla el sábado.",
  nextStep: "Confirmar la visita del sábado",
  tasks: [
    { title: "Enviar ubicación de la parcela", due: null },
    { title: "Confirmar la visita", due: "2026-10-31 11:00" },
  ],
});

const deps: RecordingDeps = {
  fetchAudio: async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: "audio/webm", fileName: "llamada.webm" }),
  transcribe: async () => "Ejecutivo: Hola Ana\nCliente: Hola, quiero ver la parcela",
  summarize: summary,
};

const NOW = new Date("2026-10-28T14:00:00Z");

beforeEach(async () => {
  await seedFunnel();
});

describe("Llamadas grabadas", () => {
  it("la grabación viene apagada y cambiarla no le pide nada a Meta", async () => {
    expect((await getCallSettings()).record).toBe(false);
    const api = {
      setCalling: async () => {
        throw new Error("no debería llamar a Meta");
      },
    } as never;
    await saveCallSettings({ enabled: false, record: true }, api);
    expect(await getCallSettings()).toEqual({ enabled: false, record: true });
  });

  it("solo guarda la grabación de quien atendió, con la grabación prendida y en la carpeta de la llamada", async () => {
    const { luis, call } = await answeredCall();
    const other = await executive("Otro");
    await expect(saveCallRecording(call.id, luis.id, URL_OK(call.id))).rejects.toThrow(/apagada/);
    expect(await canUploadRecording(call.id, luis.id)).toBe(false);

    await setSetting("calls", { enabled: true, record: true });
    expect(await canUploadRecording(call.id, luis.id)).toBe(true);
    expect(await canUploadRecording(call.id, other.id)).toBe(false);
    await expect(saveCallRecording(call.id, other.id, URL_OK(call.id))).rejects.toThrow(/no existe/);
    await expect(saveCallRecording(call.id, luis.id, URL_OK("otra"))).rejects.toThrow(/no se subió bien/);
    await expect(saveCallRecording(call.id, luis.id, "http://x/calls/" + call.id + "/a.webm")).rejects.toThrow(/no se subió bien/);

    expect(await saveCallRecording(call.id, luis.id, URL_OK(call.id))).toBe(true);
    // Una sola vez: un segundo aviso no la vuelve a mandar a transcribir.
    expect(await saveCallRecording(call.id, luis.id, URL_OK(call.id))).toBe(false);
    expect(await canUploadRecording(call.id, luis.id)).toBe(false);
    expect(await db.call.findUniqueOrThrow({ where: { id: call.id } })).toMatchObject({
      recordingUrl: URL_OK(call.id),
      analysisStatus: "PROCESSING",
    });
  });

  it("transcribe, resume y propone tareas; el ejecutivo las crea o descarta y la asistente ve el resumen", async () => {
    const { luis, lead, call } = await answeredCall();
    await setSetting("calls", { enabled: true, record: true });
    await saveCallRecording(call.id, luis.id, URL_OK(call.id));

    await analyzeCall(call.id, deps, NOW);
    const done = await db.call.findUniqueOrThrow({ where: { id: call.id } });
    expect(done).toMatchObject({
      analysisStatus: "DONE",
      transcript: "Ejecutivo: Hola Ana\nCliente: Hola, quiero ver la parcela",
      nextStep: "Confirmar la visita del sábado",
    });
    const tasks = done.proposedTasks as ProposedTask[];
    // Sin fecha acordada: mañana a las 10:00 (hora de Chile).
    expect(toLocalInput(new Date(tasks[0].dueAt))).toBe("2026-10-29T10:00");
    expect(toLocalInput(new Date(tasks[1].dueAt))).toBe("2026-10-31T11:00");

    const boss = await executive("Jefa");
    const task = await createProposedTask(call.id, 1, boss.id);
    expect(task).toMatchObject({ leadId: lead.id, title: "Confirmar la visita", assigneeId: luis.id, createdBy: "USER" });
    await expect(createProposedTask(call.id, 1, boss.id)).rejects.toThrow(/ya está creada/);
    await dismissProposedTask(call.id, 0);
    await expect(createProposedTask(call.id, 0, boss.id)).rejects.toThrow(/descartó/);
    const after = (await db.call.findUniqueOrThrow({ where: { id: call.id } })).proposedTasks as ProposedTask[];
    expect(after).toMatchObject([{ dismissed: true }, { taskId: task.id }]);

    const lines = await callLines(lead.id);
    expect(lines[0]).toMatch(/Llamadas de WhatsApp con el cliente/);
    expect(lines[1]).toMatch(/\(1:07, atendió Luis\): Ana busca una parcela en Pucón.* Próximo paso: Confirmar la visita del sábado/);
  });

  it("si falla queda el motivo, se puede reintentar y el cron retoma los que quedaron a medias", async () => {
    const { luis, call } = await answeredCall();
    await setSetting("calls", { enabled: true, record: true });
    await saveCallRecording(call.id, luis.id, URL_OK(call.id));

    await analyzeCall(call.id, { ...deps, transcribe: async () => Promise.reject(new Error("Falta la clave de OpenRouter")) }, NOW);
    expect(await db.call.findUniqueOrThrow({ where: { id: call.id } })).toMatchObject({
      analysisStatus: "FAILED",
      analysisError: "Falta la clave de OpenRouter",
    });
    expect(await callLines(call.leadId)).toEqual([]);

    expect(await retryCallAnalysis(call.id)).toBe(true);
    expect(await retryCallAnalysis(call.id)).toBe(false);
    // Recién terminada: el análisis puede seguir corriendo, el cron no la toca.
    expect(await resumeStuckAnalyses(deps, new Date("2026-10-28T13:40:00Z"))).toBe(0);
    expect(await resumeStuckAnalyses(deps, NOW)).toBe(1);
    expect((await db.call.findUniqueOrThrow({ where: { id: call.id } })).analysisStatus).toBe("DONE");
  });

  it("una grabación sin voz queda explicada y sin tareas", async () => {
    const { luis, call } = await answeredCall();
    await setSetting("calls", { enabled: true, record: true });
    await saveCallRecording(call.id, luis.id, URL_OK(call.id));
    await analyzeCall(call.id, { ...deps, transcribe: async () => "[inaudible]" }, NOW);
    expect(await db.call.findUniqueOrThrow({ where: { id: call.id } })).toMatchObject({
      analysisStatus: "DONE",
      summary: "No se escucha la conversación en la grabación.",
      proposedTasks: [],
    });
  });
});

describe("Resumen de la IA", () => {
  it("lee el JSON aunque venga con texto alrededor y limita las tareas", () => {
    const text =
      'Aquí va:\n```json\n{"resumen": "Quiere  visitar.", "proximoPaso": "", "tareas": [' +
      '{"titulo": "A", "fecha": null}, {"titulo": "B", "fecha": "2026-11-02 09:00"}, {"titulo": "C"}, {"titulo": "D"}]}\n```';
    expect(parseCallSummary(text)).toEqual({
      summary: "Quiere visitar.",
      nextStep: "",
      tasks: [
        { title: "A", due: null },
        { title: "B", due: "2026-11-02 09:00" },
        { title: "C", due: null },
      ],
    });
    expect(parseCallSummary("no sé")).toBeNull();
  });

  it("una fecha acordada que ya pasó se mueve a mañana a las 10:00", () => {
    expect(toLocalInput(proposedDueAt("2026-10-01 09:00", NOW))).toBe("2026-10-29T10:00");
    expect(toLocalInput(proposedDueAt("2026-11-03", NOW))).toBe("2026-11-03T10:00");
  });
});
