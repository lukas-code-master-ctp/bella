import { db } from "../db";
import { parseLocalDateTime, startOfLocalDay, toLocalInput } from "../dates";
import { getAssistantSettings } from "../settings";
import { audioFormat, type AudioFile } from "../media";
import { CALL_INSTRUCTIONS, openRouterTranscriber, type Transcriber } from "../ai/transcribe";
import { summarizeCall, type CallSummary } from "../ai/call-summary";
import type { ProviderClients } from "../ai/providers";
import { getCallSettings } from "./calls";
import { formatChileDateTime } from "./follow-ups";
import { DomainError } from "./leads";
import { createTask } from "./tasks";

/**
 * Llamadas grabadas. Si la empresa graba llamadas, el navegador de quien atendió graba las dos
 * voces, sube el audio directo a Vercel Blob al cortar y avisa a Beliapp; Beliapp lo transcribe,
 * la IA lo resume y propone tareas de lo acordado. El resumen entra al <crm_state> de la asistente.
 */

/** Carpeta del Blob donde el navegador sube la grabación de una llamada. */
export const recordingFolder = (callId: string) => `calls/${callId}`;

/** Tope de una grabación: ~1 hora de audio a 32 kbps, de sobra. */
export const RECORDING_MAX_BYTES = 40 * 1024 * 1024;

/** Llamadas resumidas que ve la asistente en cada turno. */
const CALLS_IN_CONTEXT = 3;

export type ProposedTask = { title: string; dueAt: string; taskId?: string; dismissed?: boolean };

export type RecordingDeps = {
  fetchAudio?: (url: string) => Promise<AudioFile>;
  transcribe?: Transcriber;
  summarize?: typeof summarizeCall;
  clients?: ProviderClients;
};

/** La llamada tiene que ser de quien la atendió y la empresa tiene que grabar llamadas. */
async function ownCall(callId: string, userId: string) {
  const call = await db.call.findFirst({ where: { id: callId, answeredById: userId } });
  if (!call) throw new DomainError("Esa llamada no existe.");
  return call;
}

/** Se puede subir la grabación de esta llamada (la usa el permiso de subida del navegador). */
export async function canUploadRecording(callId: string, userId: string) {
  const call = await db.call.findFirst({ where: { id: callId, answeredById: userId, recordingUrl: null }, select: { id: true } });
  return Boolean(call) && (await getCallSettings()).record;
}

/**
 * Guarda la grabación que subió el navegador y la deja lista para transcribir. Devuelve true si
 * hay que analizarla (la primera vez); el análisis va aparte porque tarda.
 */
export async function saveCallRecording(callId: string, userId: string, url: string): Promise<boolean> {
  const call = await ownCall(callId, userId);
  if (!(await getCallSettings()).record) throw new DomainError("La grabación de llamadas está apagada.");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new DomainError("La grabación no se subió bien.");
  }
  if (parsed.protocol !== "https:" || !parsed.pathname.startsWith(`/${recordingFolder(call.id)}/`)) {
    throw new DomainError("La grabación no se subió bien.");
  }
  const saved = await db.call.updateMany({
    where: { id: call.id, recordingUrl: null },
    data: { recordingUrl: url, analysisStatus: "PROCESSING", analysisError: null },
  });
  return saved.count > 0;
}

async function downloadAudio(url: string): Promise<AudioFile> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo descargar la grabación (HTTP ${res.status}).`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > RECORDING_MAX_BYTES) throw new Error("La grabación es demasiado larga para transcribirla.");
  const mimeType = res.headers.get("content-type") ?? "audio/webm";
  const fileName = new URL(url).pathname.split("/").pop() ?? "llamada.webm";
  return { bytes, mimeType, fileName };
}

/** Vencimiento de una tarea propuesta: el que se acordó o, si no hay (o ya pasó), mañana a las 10:00. */
export function proposedDueAt(due: string | null, now = new Date()): Date {
  const at = due ? parseLocalDateTime(due, "10:00") : null;
  if (at && at > now) return at;
  return parseLocalDateTime(`${toLocalInput(startOfLocalDay(now, 1)).slice(0, 10)} 10:00`)!;
}

/** Transcribe y resume la grabación. Si algo falla, queda el motivo y se puede reintentar. */
export async function analyzeCall(callId: string, deps: RecordingDeps = {}, now = new Date()) {
  const call = await db.call.findUnique({
    where: { id: callId },
    include: { lead: { include: { contact: true } }, answeredBy: true },
  });
  if (!call?.recordingUrl) return;
  try {
    const audio = await (deps.fetchAudio ?? downloadAudio)(call.recordingUrl);
    if (!audioFormat(audio.mimeType, audio.fileName)) throw new Error(`Formato de audio no soportado: ${audio.mimeType}`);
    const transcript = await (deps.transcribe ?? openRouterTranscriber(undefined, CALL_INSTRUCTIONS, 16000))(audio);
    let result: CallSummary;
    if (transcript.trim() === "[inaudible]") {
      result = { summary: "No se escucha la conversación en la grabación.", nextStep: "", tasks: [] };
    } else {
      const { companyName } = await getAssistantSettings();
      result = await (deps.summarize ?? summarizeCall)({
        transcript,
        companyName,
        contactName: call.lead.contact.name,
        userName: call.answeredBy?.name ?? null,
        at: call.answeredAt ?? call.createdAt,
        clients: deps.clients,
      });
    }
    const proposedTasks: ProposedTask[] = result.tasks.map((t) => ({ title: t.title, dueAt: proposedDueAt(t.due, now).toISOString() }));
    await db.call.update({
      where: { id: call.id },
      data: {
        transcript,
        summary: result.summary,
        nextStep: result.nextStep || null,
        proposedTasks,
        analysisStatus: "DONE",
        analysisError: null,
      },
    });
  } catch (err) {
    console.error(`[llamadas] análisis de ${call.id}:`, err);
    await db.call.update({
      where: { id: call.id },
      data: { analysisStatus: "FAILED", analysisError: (err instanceof Error ? err.message : String(err)).slice(0, 500) },
    });
  }
}

/** Si el análisis quedó a medias (la función se cortó), el cron lo retoma después de este rato. */
export const STUCK_ANALYSIS_MS = 15 * 60 * 1000;

/** Cron: retoma los análisis que quedaron a medias. */
export async function resumeStuckAnalyses(deps: RecordingDeps = {}, now = new Date()) {
  const stuck = await db.call.findMany({
    where: { analysisStatus: "PROCESSING", recordingUrl: { not: null }, endedAt: { lt: new Date(now.getTime() - STUCK_ANALYSIS_MS) } },
    select: { id: true },
    take: 5,
  });
  for (const c of stuck) await analyzeCall(c.id, deps, now);
  return stuck.length;
}

/** "Reintentar" en una llamada cuyo análisis falló. Devuelve true si hay que analizarla de nuevo. */
export async function retryCallAnalysis(callId: string): Promise<boolean> {
  const done = await db.call.updateMany({
    where: { id: callId, analysisStatus: "FAILED", recordingUrl: { not: null } },
    data: { analysisStatus: "PROCESSING", analysisError: null },
  });
  return done.count > 0;
}

async function proposed(callId: string, index: number) {
  const call = await db.call.findUnique({ where: { id: callId } });
  const tasks = (call?.proposedTasks as ProposedTask[] | null) ?? [];
  const task = tasks[index];
  if (!call || !task) throw new DomainError("Esa tarea ya no existe.");
  return { call, tasks, task };
}

/** Crea la tarea que propuso la IA, para quien atendió la llamada (o el ejecutivo del lead). */
export async function createProposedTask(callId: string, index: number, userId: string) {
  const { call, tasks, task } = await proposed(callId, index);
  if (task.taskId) throw new DomainError("Esa tarea ya está creada.");
  if (task.dismissed) throw new DomainError("Esa tarea se descartó.");
  const created = await createTask(
    call.leadId,
    { title: task.title, dueAt: new Date(task.dueAt), ...(call.answeredById ? { assigneeId: call.answeredById } : {}) },
    { actor: "USER", userId },
  );
  tasks[index] = { ...task, taskId: created.id };
  await db.call.update({ where: { id: call.id }, data: { proposedTasks: tasks } });
  return created;
}

export async function dismissProposedTask(callId: string, index: number) {
  const { call, tasks, task } = await proposed(callId, index);
  if (task.taskId) return;
  tasks[index] = { ...task, dismissed: true };
  await db.call.update({ where: { id: call.id }, data: { proposedTasks: tasks } });
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** Líneas del <crm_state> con lo que se habló en las últimas llamadas, para no volver a preguntarlo. */
export async function callLines(leadId: string): Promise<string[]> {
  const calls = await db.call.findMany({
    where: { leadId, summary: { not: null } },
    orderBy: { createdAt: "desc" },
    take: CALLS_IN_CONTEXT,
    include: { answeredBy: { select: { name: true } } },
  });
  if (!calls.length) return [];
  return [
    "Llamadas de WhatsApp con el cliente (lo que se habló por teléfono; no le vuelvas a preguntar lo que ya respondió ahí):",
    ...calls.reverse().map((c) => {
      const meta = [c.durationSec ? clock(c.durationSec) : null, c.answeredBy?.name ? `atendió ${c.answeredBy.name}` : null].filter(Boolean);
      return (
        `- ${formatChileDateTime(c.answeredAt ?? c.createdAt)}${meta.length ? ` (${meta.join(", ")})` : ""}: ${c.summary}` +
        (c.nextStep ? ` Próximo paso: ${c.nextStep}` : "")
      );
    }),
  ];
}
