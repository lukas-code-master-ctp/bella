import type { Stage } from "@prisma/client";
import { buildSystemPrompt } from "../ai/agent";
import { completeOnce, jsonIn } from "../ai/complete";
import { getAiConfig } from "../ai/config";
import { providerFor, type ProviderClients, type ToolResult, type TranscriptMessage } from "../ai/providers";
import { executeTool } from "../ai/tools";
import { loadRunView, turnsFromTranscript, type RunView } from "../ai/trace";
import { db } from "../db";
import { knowledgeForPrompt } from "../knowledge";
import { getAssistantSettings, setSetting, type AssistantSettings } from "../settings";
import { applyVariant } from "./ab-tests";
import { autoBlockCriteria, getAiOperation } from "./ai-operation";
import { activeLessons, createLesson, instructionsHash, setLessonStatus, type LessonForPrompt } from "./ai-lessons";
import { filesForPrompt } from "./files";
import { assistantFor, funnelStages } from "./funnels";
import { DomainError } from "./leads";
import { span } from "./reply-analysis";

/**
 * Corregir una respuesta de la IA en el lugar que la causó. Quien la analiza escribe qué esperaba;
 * la IA propone el cambio donde corresponde (un párrafo de las instrucciones, las del embudo, una
 * regla de etapa o, si nada de eso calza, un aprendizaje). Antes de guardarlo se puede probar:
 * se repite ese mismo turno con el cambio, sin enviar nada ni tocar el CRM.
 */

export type FixTarget = "instructions" | "funnel" | "stage_exit" | "stage_entry" | "lesson" | "platform";

export type FixProposal = {
  target: FixTarget;
  /** Qué se cambia, para mostrar ("Instrucciones de la asistente", "Regla de avance de «Inicial»"…). */
  label: string;
  /** En simple: qué cambia y por qué así se corrige. */
  explanation: string;
  /** Texto actual completo de lo que se cambia (vacío en un aprendizaje nuevo o en la plataforma). */
  current: string;
  /** Texto nuevo completo; en un aprendizaje, la regla. */
  proposed: string;
  /** Aprendizaje: cómo debió responder. */
  goodExample: string;
  /** Embudo o etapa que se cambia. */
  refId: string | null;
  /** Huella de `current`: si cambió entre la propuesta y el guardado, no se guarda. */
  base: string;
};

/** Lo que haría la IA con el cambio: su respuesta y las acciones que intentó (sin ejecutarlas). */
export type FixTrial = { reply: string; actions: string[] };

const MAX_REPLAY_STEPS = 6;
/** Herramientas que solo leen: en la prueba se ejecutan de verdad para que la respuesta sea fiel. */
const READ_ONLY = new Set(["search_knowledge", "search_inventory"]);

const ACTION: Record<string, (i: Record<string, unknown>) => string> = {
  move_stage: (i) => `Mover el lead a «${i.stage}»`,
  handoff_to_human: (i) => `Derivar a un ejecutivo${i.stage ? ` («${i.stage}»)` : ""}`,
  tag_contact: (i) => `Etiquetar ${i.category}: ${i.tag}`,
  update_contact: () => "Guardar datos del contacto",
  set_contact_field: (i) => `Guardar ${i.field}: ${i.value}`,
  create_task: (i) => `Crear la tarea «${i.title}»`,
  schedule_follow_up: () => "Agendar un seguimiento",
  send_file: (i) => `Enviar el archivo «${i.title ?? i.product ?? ""}»`,
  block_contact: () => "Bloquear al contacto",
};

async function aiMessage(leadId: string, messageId: string) {
  const message = await db.message.findFirst({ where: { id: messageId, leadId, author: "AI" } });
  if (!message) throw new DomainError("Solo se pueden corregir mensajes de la IA.");
  const run = await loadRunView(leadId, messageId);
  if (!run) throw new DomainError("Este mensaje no tiene registro de cómo se construyó, así que no se puede corregir aquí.");
  const lead = await db.lead.findUniqueOrThrow({
    where: { id: leadId },
    include: { stage: { include: { funnel: true } }, variant: true },
  });
  return { message, run, lead, said: message.body || message.transcript || "" };
}

const PROPOSE_PROMPT = [
  "Ayudas a una empresa a ajustar a su asistente de ventas por chat. La asistente respondió algo que la " +
    "empresa no esperaba. Propón UN cambio en su configuración para que en casos así responda lo esperado.",
  "",
  "Recibes lo que tenía la asistente en ese turno (<instrucciones_de_la_asistente>, <turno>), su " +
    "<respuesta>, lo que la empresa <esperaba>, y las partes que la empresa puede editar: " +
    "<instrucciones_generales>, <instrucciones_del_embudo> y <etapas> (con su regla de avance y su regla " +
    "de derivación).",
  "",
  "Elige donde (en este orden de preferencia):",
  '- "instrucciones" o "embudo": si un párrafo de esas instrucciones causó la respuesta o le falta una ' +
    "excepción. Cambia lo mínimo: en buscar copia EXACTAMENTE el fragmento actual que reemplazas (una o " +
    "pocas frases) y en reemplazar el texto nuevo, con el mismo estilo. Para agregar algo nuevo sin " +
    "reemplazar, deja buscar vacío y pon en reemplazar el párrafo que se agrega al final.",
  '- "regla_avance" o "regla_derivacion": si el problema es cuándo mover o derivar el lead. En etapa el ' +
    "nombre exacto de la etapa y en reemplazar el texto completo nuevo de esa regla.",
  '- "aprendizaje": si no calza en ninguna parte. En reemplazar la regla (una o dos frases en ' +
    "imperativo, sin datos del cliente) y en ejemplo_bueno cómo debió ser la respuesta.",
  '- "plataforma": solo si la causa está en cómo funciona el sistema y no en algo que la empresa ' +
    "escribió (por ejemplo, la asistente no recibió un dato). No propongas cambio.",
  "",
  "La regla tiene que servir para conversaciones parecidas, no solo para este cliente. En explicacion, " +
    "dos frases simples: qué cambia y por qué con eso responde como se esperaba.",
  "",
  'Responde solo un JSON: {"donde": "...", "etapa": "", "buscar": "", "reemplazar": "...", "ejemplo_bueno": "", "explicacion": "..."}',
].join("\n");

const WHERE: Record<string, FixTarget> = {
  instrucciones: "instructions",
  embudo: "funnel",
  regla_avance: "stage_exit",
  regla_derivacion: "stage_entry",
  aprendizaje: "lesson",
  plataforma: "platform",
};

/** Reemplaza `find` por `replace` en el texto; con `find` vacío, agrega al final. */
function edit(text: string, find: string, replace: string): string {
  if (!find.trim()) return `${text.trimEnd()}\n\n${replace.trim()}`;
  const at = span(text, find);
  if (!at) throw new DomainError("La IA propuso cambiar un texto que no está en la configuración. Intenta de nuevo.");
  return text.slice(0, at[0]) + replace.trim() + text.slice(at[1]);
}

const findStage = (stages: Stage[], name: string) =>
  stages.find((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase()) ?? null;

/** Propone el cambio. No guarda nada. */
export async function proposeFix(
  { leadId, messageId, expected }: { leadId: string; messageId: string; expected: string },
  clients: ProviderClients = {},
): Promise<FixProposal> {
  const wanted = expected.trim();
  if (!wanted) throw new DomainError("Escribe qué esperabas que respondiera.");
  const { run, lead, said } = await aiMessage(leadId, messageId);
  const [settings, stages] = await Promise.all([getAssistantSettings(), funnelStages(db, lead.stage.funnelId)]);
  const funnel = lead.stage.funnel;

  const input = [
    "<instrucciones_de_la_asistente>",
    run.system ?? "(no quedaron guardadas; usa las instrucciones generales de abajo)",
    "</instrucciones_de_la_asistente>",
    "<turno>",
    run.context,
    "</turno>",
    "<respuesta>",
    said,
    "</respuesta>",
    "<esperaba>",
    wanted,
    "</esperaba>",
    "<instrucciones_generales>",
    settings.instructions,
    "</instrucciones_generales>",
    "<instrucciones_del_embudo>",
    funnel?.instructions?.trim() || "(vacías)",
    "</instrucciones_del_embudo>",
    "<etapas>",
    ...stages.map(
      (s) =>
        `- ${s.name}${s.requiresHuman ? " [atención humana]" : ""}: regla de avance: ${s.exitCriteria?.trim() || "(vacía)"}` +
        (s.requiresHuman ? `; regla de derivación: ${s.entryCriteria?.trim() || "(vacía)"}` : ""),
    ),
    "</etapas>",
  ].join("\n");

  const { text } = await completeOnce({ system: PROPOSE_PROMPT, input, maxTokens: 6000, effort: "medium", clients });
  const parsed = jsonIn(text) as Record<string, unknown> | null;
  const str = (k: string) => (typeof parsed?.[k] === "string" ? (parsed[k] as string).trim() : "");
  const target = WHERE[str("donde")];
  const explanation = str("explicacion");
  if (!target || !explanation) throw new DomainError("La IA no pudo proponer un cambio. Intenta de nuevo.");
  const replace = str("reemplazar");
  if (target !== "platform" && !replace) throw new DomainError("La IA no pudo proponer un cambio. Intenta de nuevo.");
  const proposal = (p: Omit<FixProposal, "explanation" | "goodExample" | "base">): FixProposal => ({
    ...p,
    explanation,
    goodExample: target === "lesson" ? str("ejemplo_bueno") : "",
    base: instructionsHash(p.current),
  });

  switch (target) {
    case "instructions":
      return proposal({
        target,
        label: "Instrucciones de la asistente",
        current: settings.instructions,
        proposed: edit(settings.instructions, str("buscar"), replace),
        refId: null,
      });
    case "funnel": {
      if (!funnel) throw new DomainError("El lead no tiene embudo. Intenta de nuevo.");
      const current = funnel.instructions ?? "";
      return proposal({
        target,
        label: `Instrucciones del embudo «${funnel.name}»`,
        current,
        proposed: current.trim() ? edit(current, str("buscar"), replace) : replace,
        refId: funnel.id,
      });
    }
    case "stage_exit":
    case "stage_entry": {
      const stage = findStage(stages, str("etapa"));
      if (!stage || (target === "stage_entry" && !stage.requiresHuman)) {
        throw new DomainError("La IA propuso cambiar una etapa que no existe. Intenta de nuevo.");
      }
      const current = (target === "stage_exit" ? stage.exitCriteria : stage.entryCriteria) ?? "";
      return proposal({
        target,
        label: `${target === "stage_exit" ? "Regla de avance" : "Regla de derivación"} de «${stage.name}»`,
        current,
        proposed: replace,
        refId: stage.id,
      });
    }
    case "lesson":
      return proposal({ target, label: "Aprendizaje nuevo", current: "", proposed: replace, refId: null });
    case "platform":
      return proposal({ target, label: "Funcionamiento de la plataforma", current: "", proposed: "", refId: null });
  }
}

/** Lo que tendría la IA en ese turno con el cambio: instrucciones de hoy con el cambio, y el turno guardado. */
async function changedTurn(
  { lead, run }: { lead: Awaited<ReturnType<typeof aiMessage>>["lead"]; run: RunView },
  fix: Pick<FixProposal, "target" | "proposed" | "goodExample" | "refId" | "current">,
) {
  const [base, operation, knowledge, files, lessons] = await Promise.all([
    getAssistantSettings(),
    getAiOperation(),
    knowledgeForPrompt(),
    filesForPrompt(),
    activeLessons(),
  ]);
  let settings: AssistantSettings = base;
  let funnel = lead.stage.funnel;
  const withLesson: LessonForPrompt[] = [...lessons];
  if (fix.target === "instructions") settings = { ...base, instructions: fix.proposed };
  if (fix.target === "funnel" && funnel) funnel = { ...funnel, instructions: fix.proposed };
  if (fix.target === "lesson") withLesson.push({ rule: fix.proposed, goodExample: fix.goodExample, badExample: "" });
  const system = buildSystemPrompt(
    applyVariant(assistantFor(settings, funnel), lead.variant),
    knowledge,
    files,
    autoBlockCriteria(operation),
    withLesson,
  );

  let context = run.context;
  if (fix.target === "stage_exit" || fix.target === "stage_entry") {
    const old = fix.current.trim();
    const at = old ? span(context, old) : null;
    if (at) context = context.slice(0, at[0]) + fix.proposed.trim() + context.slice(at[1]);
    else {
      const stage = await db.stage.findUnique({ where: { id: fix.refId ?? "" } });
      const line =
        fix.target === "stage_exit"
          ? `Regla de avance definida por la empresa: - Desde "${stage?.name}": ${fix.proposed.trim()}`
          : `Cuándo derivar a atención humana (definido por la empresa): - A "${stage?.name}": ${fix.proposed.trim()}`;
      context = context.includes("</crm_state>") ? context.replace("</crm_state>", `${line}\n</crm_state>`) : `${line}\n${context}`;
    }
  }
  return { system, context };
}

/** El historial de la IA antes de ese turno, para repetirlo con lo que sabía entonces. */
async function historyBefore(leadId: string, context: string, format: string): Promise<TranscriptMessage[]> {
  const transcript = await db.agentTranscript.findUnique({ where: { leadId } });
  if (!transcript || transcript.format !== format) return [];
  const messages = transcript.messages as unknown as TranscriptMessage[];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role !== "user") continue;
    const [turn] = turnsFromTranscript(transcript.format, [messages[i]]);
    if (turn?.context === context) return messages.slice(0, i);
  }
  return [];
}

/**
 * Repite el turno con el cambio, sin enviar nada: las búsquedas se ejecutan de verdad y las demás
 * herramientas (mover, etiquetar, enviar archivos…) solo se anotan como acciones que haría.
 */
export async function tryFix(
  { leadId, messageId, fix }: { leadId: string; messageId: string; fix: Pick<FixProposal, "target" | "proposed" | "goodExample" | "refId" | "current"> },
  clients: ProviderClients = {},
): Promise<FixTrial> {
  if (fix.target === "platform") throw new DomainError("Este caso no se corrige desde la configuración.");
  if (!fix.proposed.trim()) throw new DomainError("El cambio no puede quedar vacío.");
  const found = await aiMessage(leadId, messageId);
  const { system, context } = await changedTurn(found, fix);
  const provider = providerFor(await getAiConfig(), clients);
  const messages = [...(await historyBefore(leadId, found.run.context, provider.format)), provider.userTurn(context)];

  const actions: string[] = [];
  for (let step = 0; step < MAX_REPLAY_STEPS; step++) {
    const result = await provider.step(system, messages);
    if (!result.message) throw new DomainError("El modelo no quiso responder en la prueba. Intenta de nuevo.");
    messages.push(result.message);
    if (result.paused) continue;
    if (!result.toolCalls.length) return { reply: result.text.trim(), actions };
    const results: ToolResult[] = [];
    for (const call of result.toolCalls) {
      if (READ_ONLY.has(call.name)) {
        const outcome = await executeTool(leadId, call.name, call.input).catch((err: unknown) => ({
          isError: true,
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        }));
        results.push({ id: call.id, ...outcome });
        continue;
      }
      actions.push(ACTION[call.name]?.(call.input) ?? call.name);
      results.push({ id: call.id, content: "Listo." });
    }
    messages.push(...provider.toolResults(results));
  }
  throw new DomainError("La prueba no terminó en una respuesta. Intenta de nuevo.");
}

/** Guarda el cambio. Si lo que se cambia se editó desde la propuesta, no guarda. */
export async function applyFix(
  { leadId, messageId, fix, createdBy }: { leadId: string; messageId: string; fix: FixProposal; createdBy: string },
) {
  const text = fix.proposed.trim();
  if (fix.target === "platform") throw new DomainError("Este caso no se corrige desde la configuración.");
  if (!text && fix.target !== "stage_exit" && fix.target !== "stage_entry") throw new DomainError("El cambio no puede quedar vacío.");
  const changed = () => {
    throw new DomainError("Ese texto cambió desde la propuesta. Vuelve a proponer el cambio.");
  };

  switch (fix.target) {
    case "instructions": {
      const settings = await getAssistantSettings();
      if (instructionsHash(settings.instructions) !== fix.base) changed();
      await setSetting<AssistantSettings>("assistant", { ...settings, instructions: text });
      return;
    }
    case "funnel": {
      const funnel = await db.funnel.findUnique({ where: { id: fix.refId ?? "" } });
      if (!funnel) throw new DomainError("El embudo ya no existe.");
      if (instructionsHash(funnel.instructions ?? "") !== fix.base) changed();
      await db.funnel.update({ where: { id: funnel.id }, data: { instructions: text } });
      return;
    }
    case "stage_exit":
    case "stage_entry": {
      const stage = await db.stage.findUnique({ where: { id: fix.refId ?? "" } });
      if (!stage) throw new DomainError("La etapa ya no existe.");
      const field = fix.target === "stage_exit" ? "exitCriteria" : "entryCriteria";
      if (instructionsHash(stage[field] ?? "") !== fix.base) changed();
      await db.stage.update({ where: { id: stage.id }, data: { [field]: text || null } });
      return;
    }
    case "lesson": {
      // Lo aplica un admin desde aquí: queda aprobado de inmediato.
      const lesson = await createLesson({
        messageId,
        rule: text,
        goodExample: fix.goodExample,
        badExample: (await db.message.findFirst({ where: { id: messageId, leadId } }))?.body ?? "",
        feedback: fix.explanation,
        conflict: "",
        createdBy,
      });
      await setLessonStatus(lesson.id, "ACTIVE");
      return;
    }
  }
}

