import { buildSystemPrompt } from "../ai/agent";
import { completeOnce, jsonIn } from "../ai/complete";
import type { ProviderClients } from "../ai/providers";
import { loadRunView, type RunView, type TraceStep } from "../ai/trace";
import { db } from "../db";
import { knowledgeForPrompt } from "../knowledge";
import { activeLessons, assistantForLead } from "./ai-lessons";
import { filesForPrompt } from "./files";
import { DomainError } from "./leads";

/**
 * Analizar una respuesta de la IA: otra llamada a la IA lee lo que se guardó de ese turno
 * (instrucciones, estado del CRM y mensajes, razonamiento y herramientas) y explica en simple por
 * qué respondió así, citando los fragmentos que más pesaron. De dónde sale cada cita (instrucciones,
 * aprendizaje, regla de etapa, conocimiento, plataforma…) lo decide el código buscando la cita en el
 * texto, no la IA.
 */

export type SourceKind =
  | "platform"
  | "instructions"
  | "funnel"
  | "variant"
  | "lesson"
  | "files"
  | "block"
  | "knowledge"
  | "stage_rule"
  | "crm"
  | "conversation"
  | "unknown";

export type CitationSource = { kind: SourceKind; label: string; href: string | null };
export type Citation = { quote: string; why: string; source: CitationSource };
export type ReplyAnalysis = {
  summary: string;
  citations: Citation[];
  missing: string[];
  /** El turno no guardó sus instrucciones: se analizó con la configuración de hoy. */
  currentConfig: boolean;
};

const MAX_CITATIONS = 5;
const MAX_STEP_TEXT = 6000;

type Segment = { start: number; kind: SourceKind; label: string; href: string | null };

const PLATFORM: Omit<Segment, "start"> = { kind: "platform", label: "Regla de la plataforma (no se edita)", href: null };
const INSTRUCTIONS: Omit<Segment, "start"> = { kind: "instructions", label: "Instrucciones de la asistente", href: "/settings/assistant" };

/** Tramos de las instrucciones (ver buildSystemPrompt), en orden, cada uno con su origen. */
export function systemSegments(system: string): Segment[] {
  const segments: Segment[] = [];
  const at = (marker: string, from = 0) => system.indexOf(marker, from);
  const own = at("\nInstrucciones de la empresa:\n");
  if (own < 0) return [{ start: 0, ...PLATFORM }];
  segments.push({ start: 0, ...PLATFORM }, { start: own + 1, ...INSTRUCTIONS });

  // Lo que viene después de las instrucciones, en el orden en que lo arma buildSystemPrompt.
  const after = [
    { marker: "\nAprendizajes aprobados por la empresa", kind: "lesson", label: "Aprendizaje aprobado", href: "/settings/lessons" },
    { marker: "\n<archivos>", kind: "files", label: "Archivos para enviar", href: "/settings/knowledge/files" },
    { marker: "\n<criterios_de_bloqueo>", kind: "block", label: "Criterios de bloqueo", href: "/settings/ai-operation" },
    { marker: "\n<base_de_conocimiento>", kind: "knowledge", label: "Base de conocimiento", href: "/settings/knowledge" },
  ] as const;
  let end = system.length;
  const found = after.map((a) => ({ ...a, index: at(a.marker, own) })).filter((a) => a.index >= 0);
  if (found.length) end = Math.min(...found.map((a) => a.index));

  // Dentro de las instrucciones: lo propio del embudo y de la variante A/B va al final (ver
  // assistantFor y applyVariant).
  const funnel = system.lastIndexOf("\n\nEn esta línea de negocio:\n", end);
  if (funnel > own) segments.push({ start: funnel + 2, kind: "funnel", label: "Instrucciones del embudo", href: "/settings/funnel" });
  const variant = system.lastIndexOf("\n\nAdemás:\n", end);
  if (variant > Math.max(own, funnel)) segments.push({ start: variant + 2, kind: "variant", label: "Variante de la prueba A/B", href: "/settings/ab-tests" });

  for (const a of found) {
    segments.push({ start: a.index + 1, kind: a.kind, label: a.label, href: a.href });
    if (a.kind !== "knowledge") continue;
    // Cada documento de la base de conocimiento con su título.
    const doc = /<documento titulo="([^"]*)">/g;
    doc.lastIndex = a.index;
    for (let m = doc.exec(system); m; m = doc.exec(system)) {
      segments.push({ start: m.index, kind: "knowledge", label: `Base de conocimiento: ${m[1]}`, href: a.href });
    }
  }
  return segments.sort((x, y) => x.start - y.start);
}

/** Tramos de lo que recibió la IA en el turno: el estado del CRM y los mensajes. */
export function contextSegments(context: string): Segment[] {
  const segments: Segment[] = [{ start: 0, kind: "crm", label: "Estado del CRM", href: null }];
  const close = context.indexOf("</crm_state>");
  for (const header of ["Reglas de avance entre etapas", "Cuándo derivar a atención humana"]) {
    const i = context.indexOf(`\n${header}`);
    if (i < 0 || (close >= 0 && i > close)) continue;
    segments.push({ start: i + 1, kind: "stage_rule", label: "Regla de etapa", href: "/settings/funnel" });
    // La regla termina en la primera línea que no es parte de la lista.
    let line = context.indexOf("\n", i + 1);
    while (line >= 0 && context.startsWith("\n- ", line)) line = context.indexOf("\n", line + 1);
    if (line >= 0) segments.push({ start: line + 1, kind: "crm", label: "Estado del CRM", href: null });
  }
  if (close >= 0) segments.push({ start: close, kind: "conversation", label: "Conversación", href: null });
  return segments.sort((x, y) => x.start - y.start);
}

/** Texto con los espacios colapsados y, para cada carácter, su posición en el original. */
function normalized(text: string) {
  let out = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (out.endsWith(" ") || !out) continue;
      out += " ";
    } else out += ch;
    map.push(i);
  }
  return { out, map };
}

const tidy = (quote: string) =>
  quote
    .trim()
    .replace(/^["“«'…\s]+|["”»'…\s]+$/g, "")
    .replace(/\.\.\.$/, "")
    .replace(/\s+/g, " ");

/** Posición de la cita en el texto (tolera espacios distintos y comillas o "…" alrededor). */
export function locate(text: string, quote: string): number {
  const q = tidy(quote);
  if (!q) return -1;
  const { out, map } = normalized(text);
  let i = out.indexOf(q);
  // Si la IA cambió algo hacia el final, basta el comienzo.
  if (i < 0 && q.length > 60) i = out.indexOf(q.slice(0, 60));
  return i < 0 ? -1 : map[i];
}

function sourceAt(segments: Segment[], index: number): CitationSource {
  let found = segments[0];
  for (const s of segments) if (s.start <= index) found = s;
  return { kind: found.kind, label: found.label, href: found.href };
}

/** De dónde sale la cita: primero se busca en lo que recibió en el turno y luego en las instrucciones. */
export function citationSource(quote: string, system: string, context: string): CitationSource {
  const inContext = locate(context, quote);
  if (inContext >= 0) return sourceAt(contextSegments(context), inContext);
  const inSystem = locate(system, quote);
  if (inSystem >= 0) return sourceAt(systemSegments(system), inSystem);
  return { kind: "unknown", label: "No aparece tal cual en la configuración", href: null };
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

function stepsText(steps: TraceStep[]) {
  const lines = steps.flatMap((s) => {
    if (s.type === "model") {
      return [
        ...(s.reasoning ? [`[razonamiento]\n${clip(s.reasoning, MAX_STEP_TEXT)}`] : []),
        ...(s.text ? [`[texto]\n${clip(s.text, MAX_STEP_TEXT)}`] : []),
      ];
    }
    if (s.type === "tool") {
      return [`[herramienta ${s.name}] ${JSON.stringify(s.input)}\n→ ${clip(s.result, 1500)}${s.isError ? " (falló)" : ""}`];
    }
    return [s.type === "error" ? `[error] ${s.message}` : "[el modelo se negó a responder]"];
  });
  return lines.join("\n\n") || "(no quedó registro de razonamiento ni de herramientas)";
}

const EXPLAIN_PROMPT = [
  "Explicas a una empresa por qué su asistente de ventas por chat respondió lo que respondió, para " +
    "que pueda ajustarla. Quien lee no es técnico.",
  "",
  "Recibes las instrucciones que tenía la asistente (<instrucciones_de_la_asistente>), lo que recibió " +
    "en ese turno (<turno>: estado del CRM y mensajes nuevos), lo que hizo (<pasos>: su razonamiento y " +
    "las herramientas que usó) y la respuesta que envió (<respuesta>).",
  "",
  "- resumen: de 2 a 4 frases simples sobre por qué respondió así. Habla de \"la asistente\". Si su " +
    "razonamiento lo dice, úsalo; si no, dedúcelo de las instrucciones y dilo.",
  `- citas: de 1 a ${MAX_CITATIONS} fragmentos que más pesaron en la respuesta, de mayor a menor peso. ` +
    "Cópialos EXACTAMENTE, palabra por palabra, de <instrucciones_de_la_asistente> o de <turno> (una o " +
    "dos frases, sin recortar palabras ni agregar comillas). En por_que, una frase sobre cómo influyó.",
  "- falto: lo que la asistente no sabía o entendió mal y que habría cambiado la respuesta (por ejemplo, " +
    "un dato que no estaba en el estado del CRM, o un mensaje que interpretó como de otra persona). Frases " +
    "cortas; lista vacía si no falta nada.",
  "",
  'Responde solo un JSON: {"resumen": "...", "citas": [{"texto": "...", "por_que": "..."}], "falto": ["..."]}',
].join("\n");

/** Instrucciones del turno; si el turno no las guardó, las de hoy. */
async function systemFor(run: RunView, leadId: string) {
  if (run.system) return { system: run.system, currentConfig: false };
  const settings = await assistantForLead(leadId);
  const [knowledge, files, lessons] = await Promise.all([knowledgeForPrompt(), filesForPrompt(), activeLessons()]);
  return { system: buildSystemPrompt(settings, knowledge, files, null, lessons), currentConfig: true };
}

/** Explica por qué la IA envió ese mensaje. No guarda nada. */
export async function explainReply(
  { leadId, messageId }: { leadId: string; messageId: string },
  clients: ProviderClients = {},
): Promise<ReplyAnalysis> {
  const message = await db.message.findFirst({ where: { id: messageId, leadId, author: "AI" } });
  if (!message) throw new DomainError("Solo se pueden analizar mensajes de la IA.");
  const run = await loadRunView(leadId, messageId);
  if (!run) throw new DomainError("Este mensaje no tiene registro de cómo se construyó, así que no se puede analizar.");
  const { system, currentConfig } = await systemFor(run, leadId);
  const sent = message.body || message.transcript || "";

  const input = [
    "<instrucciones_de_la_asistente>",
    system,
    "</instrucciones_de_la_asistente>",
    "<turno>",
    run.context,
    "</turno>",
    "<pasos>",
    stepsText(run.steps),
    "</pasos>",
    "<respuesta>",
    sent,
    "</respuesta>",
  ].join("\n");

  const { text } = await completeOnce({ system: EXPLAIN_PROMPT, input, maxTokens: 6000, effort: "medium", clients });
  const parsed = jsonIn(text) as { resumen?: unknown; citas?: unknown; falto?: unknown } | null;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const summary = str(parsed?.resumen);
  if (!summary) throw new DomainError("La IA no pudo analizar la respuesta. Intenta de nuevo.");

  const citations = (Array.isArray(parsed?.citas) ? parsed.citas : [])
    .map((c: { texto?: unknown; por_que?: unknown }) => ({ quote: tidy(str(c?.texto)), why: str(c?.por_que) }))
    .filter((c) => c.quote)
    .slice(0, MAX_CITATIONS)
    .map((c) => ({ ...c, source: citationSource(c.quote, system, run.context) }));
  const missing = (Array.isArray(parsed?.falto) ? parsed.falto : []).map(str).filter(Boolean);
  return { summary, citations, missing, currentConfig };
}
