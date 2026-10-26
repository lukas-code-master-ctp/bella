"use server";

import { revalidatePath } from "next/cache";
import { parseLocalDateTime } from "@/lib/dates";
import { afterInCompany } from "@/lib/company-request";
import { canAccessLead, requireAdmin, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAiConfig, missingKeyMessage } from "@/lib/ai/config";
import { runAgent } from "@/lib/ai/agent";
import { sendFollowUpNow } from "@/lib/ai/follow-ups";
import { withLeadClaim } from "@/lib/ai/respond";
import { deliverOutbound } from "@/lib/domain/channels";
import { blockContact, optBackIn, unblockContact } from "@/lib/domain/contacts";
import { findDuplicatesOf, mergeContacts } from "@/lib/domain/contact-import";
import { cancelFollowUp } from "@/lib/domain/follow-ups";
import { refreshLeadInsights } from "@/lib/ai/insights";
import { draftExecutiveReply } from "@/lib/ai/draft-reply";
import { loadRunView } from "@/lib/ai/trace";
import { setContactFields } from "@/lib/domain/fields";
import { createLesson, draftLesson, type LessonDraft } from "@/lib/domain/ai-lessons";
import {
  addTag,
  closeLead,
  dismissReply,
  DomainError,
  moveStage,
  removeTag,
  reopenLead,
  setAiEnabled,
  setAssignee,
} from "@/lib/domain/leads";
import { receiveContactAudio, sendUserAudio } from "@/lib/domain/messages";
import { sendLibraryFiles, sendUploadedFile, type UploadedFile } from "@/lib/domain/files";
import { notifyContactMessage } from "@/lib/domain/notifications";
import { BLOB_MISSING } from "@/lib/media";

async function authorize(leadId: string) {
  const user = await requireUser();
  const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId }, include: { contact: true } });
  if (!canAccessLead(user, lead)) throw new Error("Sin acceso a este lead.");
  return { user, lead, by: { actor: "USER" as const, userId: user.id } };
}

const BLOCKED = "El contacto está bloqueado. Desbloquéalo para escribirle.";

function done(leadId: string) {
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/funnel");
  revalidatePath("/chats");
}

/** Recalcula el resumen y el puntaje después de responder, sin demorar la respuesta. */
async function refreshInsightsLater(leadId: string) {
  await afterInCompany(() => refreshLeadInsights(leadId));
}

/** Simulador: escribe (o manda una nota de voz) como si fueras el cliente y deja que la IA responda. */
export async function sendAsContactAction(leadId: string, _prev: string | null, form: FormData) {
  const { lead } = await authorize(leadId);
  if (lead.contact.channel !== "SIMULATOR") return "Solo disponible en leads del simulador.";
  if (lead.contact.blockedAt) return BLOCKED;
  const body = String(form.get("body") ?? "").trim();
  const audio = await audioFrom(form);
  if (audio) {
    try {
      await receiveContactAudio(leadId, audio);
    } catch (e) {
      return audioError(e);
    }
    if (body) await db.message.create({ data: { leadId, author: "CONTACT", body } });
    await notifyContactMessage(leadId, body || "🎤 Nota de voz");
  } else if (body) {
    await db.message.create({ data: { leadId, author: "CONTACT", body } });
    await notifyContactMessage(leadId, body);
  } else {
    return null;
  }
  if (lead.aiEnabled && lead.status === "OPEN") {
    const missing = await missingKeyMessage((await getAiConfig()).provider);
    if (missing) {
      done(leadId);
      return missing;
    }
    await withLeadClaim(leadId, () => runAgent(leadId));
  }
  await refreshInsightsLater(leadId);
  done(leadId);
  return null;
}

/** Lee la nota de voz del formulario (null si no viene). */
async function audioFrom(form: FormData) {
  const audio = form.get("audio");
  if (!(audio instanceof File) || audio.size === 0) return null;
  return { bytes: new Uint8Array(await audio.arrayBuffer()), mimeType: audio.type, fileName: audio.name };
}

function audioError(e: unknown) {
  if (e instanceof DomainError) return e.message;
  console.error(e);
  return e instanceof Error && e.message === BLOB_MISSING ? e.message : "No se pudo guardar el audio. Intenta de nuevo.";
}

/**
 * Respuesta de un ejecutivo, escrita o como nota de voz grabada en el chat. Al responder, el
 * ejecutivo toma la conversación y la IA se pausa.
 */
export async function sendAsUserAction(leadId: string, form: FormData): Promise<string | null> {
  const { user, lead, by } = await authorize(leadId);
  if (lead.contact.blockedAt) return BLOCKED;
  const body = String(form.get("body") ?? "").trim();
  const audio = await audioFrom(form);
  if (audio) {
    try {
      await sendUserAudio(leadId, user.id, audio);
    } catch (e) {
      return audioError(e);
    }
  }
  if (body) await db.message.create({ data: { leadId, author: "USER", userId: user.id, body } });
  if (!audio && !body) return null;
  if (lead.aiEnabled) await setAiEnabled(leadId, false, by);
  // En WhatsApp el mensaje sale al cliente; si no se pudo, el ejecutivo ve el motivo.
  const failed = await deliverOutbound(leadId);
  await refreshInsightsLater(leadId);
  done(leadId);
  return failed;
}

/** Lo que el ejecutivo eligió en el clip: archivos de la biblioteca o uno subido desde su equipo. */
export type FilesToSend = { libraryIds: string[]; caption: string } | { upload: UploadedFile; caption: string };

/** El ejecutivo manda archivos desde el chat; igual que al escribir, toma la conversación y la IA se pausa. */
export async function sendFilesAction(leadId: string, files: FilesToSend): Promise<string | null> {
  const { user, lead, by } = await authorize(leadId);
  if (lead.contact.blockedAt) return BLOCKED;
  try {
    if ("upload" in files) await sendUploadedFile(leadId, user.id, files.upload, files.caption);
    else await sendLibraryFiles(leadId, user.id, files.libraryIds, files.caption);
  } catch (e) {
    if (e instanceof DomainError) return e.message;
    throw e;
  }
  if (lead.aiEnabled) await setAiEnabled(leadId, false, by);
  const failed = await deliverOutbound(leadId);
  await refreshInsightsLater(leadId);
  done(leadId);
  return failed;
}

/** Biblioteca de archivos (Conocimiento → Archivos) para elegir desde el chat. */
export async function libraryFilesAction(leadId: string) {
  await authorize(leadId);
  const files = await db.mediaFile.findMany({ orderBy: [{ product: "asc" }, { title: "asc" }] });
  return files.map((f) => ({ id: f.id, title: f.title, product: f.product, fileName: f.fileName, mimeType: f.mimeType, url: f.url }));
}

export async function moveStageAction(leadId: string, form: FormData) {
  const { by } = await authorize(leadId);
  await moveStage(leadId, String(form.get("stageId")), by);
  done(leadId);
}

export async function setAssigneeAction(leadId: string, form: FormData) {
  const { user, by } = await authorize(leadId);
  if (user.role !== "ADMIN") throw new Error("Solo un admin puede reasignar.");
  await setAssignee(leadId, String(form.get("assigneeId") || "") || null, by);
  done(leadId);
}

/** "No requiere respuesta": saca al lead de "Sin atender" sin escribirle; opcionalmente agenda retomarlo. */
export async function dismissReplyAction(leadId: string, _prev: string | null, form: FormData): Promise<string | null> {
  const { by } = await authorize(leadId);
  const raw = String(form.get("resumeAt") ?? "");
  // Solo la fecha: la tarea vence ese día a las 10:00 (Chile).
  const resumeAt = raw ? parseLocalDateTime(`${raw}T10:00`) : null;
  if (raw && !resumeAt) return "Indica una fecha válida para retomar.";
  try {
    await dismissReply(leadId, by, { resumeAt });
  } catch (e) {
    if (e instanceof DomainError) return e.message;
    throw e;
  }
  done(leadId);
  return null;
}

export async function toggleAiAction(leadId: string, enabled: boolean) {
  const { by } = await authorize(leadId);
  await setAiEnabled(leadId, enabled, by);
  if (enabled) {
    await withLeadClaim(leadId, () => runAgent(leadId)).catch((e) => console.error(e));
    await refreshInsightsLater(leadId);
  }
  done(leadId);
}

/** Pide a la IA el seguimiento del lead ahora (para no esperar el plazo, ej. al probar). */
export async function sendFollowUpNowAction(leadId: string, _prev: string | null): Promise<string | null> {
  const { lead } = await authorize(leadId);
  if (!lead.aiEnabled || lead.status !== "OPEN") return "La IA debe estar activa en un lead abierto.";
  const missing = await missingKeyMessage((await getAiConfig()).provider);
  if (missing) return missing;
  const outcome = await sendFollowUpNow(leadId);
  done(leadId);
  if (outcome === "sent") return null;
  if (outcome === "error") return "No se pudo enviar el seguimiento.";
  return "La IA no envió seguimiento: el último mensaje no es de ella o decidió que no corresponde escribir.";
}

export async function cancelFollowUpAction(leadId: string) {
  const { user } = await authorize(leadId);
  await cancelFollowUp(leadId, user.id);
  done(leadId);
}

export async function addTagAction(leadId: string, form: FormData) {
  const { by } = await authorize(leadId);
  const tagId = String(form.get("tagId") || "");
  if (tagId) await addTag(leadId, tagId, by);
  done(leadId);
}

export async function removeTagAction(leadId: string, tagId: string) {
  const { by } = await authorize(leadId);
  await removeTag(leadId, tagId, by);
  done(leadId);
}

/** Campos del cliente editados desde la ficha del lead. */
export async function saveFieldsAction(leadId: string, _prev: string | null, form: FormData) {
  const { by } = await authorize(leadId);
  const values: Record<string, string> = {};
  for (const [key, value] of form.entries()) if (!key.startsWith("$")) values[key] = String(value);
  try {
    await setContactFields(leadId, values, by);
  } catch (e) {
    if (e instanceof DomainError) return e.message;
    throw e;
  }
  done(leadId);
  return "Guardado.";
}

export async function closeLeadAction(leadId: string, _prev: string | null, form: FormData) {
  const { by } = await authorize(leadId);
  const outcome = form.get("outcome") === "WON" ? "WON" : "LOST";
  const amountRaw = String(form.get("amount") ?? "").replace(/\D/g, "");
  try {
    await closeLead(leadId, outcome, by, {
      amount: amountRaw ? Number(amountRaw) : null,
      lostReason: String(form.get("lostReason") ?? ""),
      amountRequired: form.get("amountRequired") === "on",
    });
  } catch (e) {
    if (e instanceof DomainError) return e.message;
    throw e;
  }
  done(leadId);
  return null;
}

export async function reopenLeadAction(leadId: string) {
  const { by } = await authorize(leadId);
  await reopenLead(leadId, by);
  done(leadId);
}

/** Recalcula a pedido el resumen y el puntaje del lead. */
export async function refreshInsightsAction(leadId: string): Promise<string | null> {
  await authorize(leadId);
  const ok = await refreshLeadInsights(leadId, { force: true });
  done(leadId);
  return ok ? null : "No se pudo generar el resumen. Revisa el modelo en Configuración → Asistente IA.";
}

/** Monitor de actividad: cómo la IA construyó uno de sus mensajes. */
export async function getAgentRunAction(leadId: string, messageId: string) {
  await authorize(leadId);
  return loadRunView(leadId, messageId);
}

export type CorrectionState = { error: string | null; feedback: string; draft: LessonDraft | null; saved: boolean };

async function authorizeAiMessage(leadId: string, messageId: string) {
  const { user } = await authorize(leadId);
  const message = await db.message.findUnique({ where: { id: messageId } });
  if (!message || message.leadId !== leadId || message.author !== "AI") throw new Error("Mensaje no encontrado.");
  return user;
}

/** Corregir una respuesta de la IA, paso 1: la IA redacta la regla a partir de la corrección. */
export async function draftLessonAction(leadId: string, messageId: string, _prev: CorrectionState, form: FormData): Promise<CorrectionState> {
  await authorizeAiMessage(leadId, messageId);
  const feedback = String(form.get("feedback") ?? "").trim();
  const failed = (error: string) => ({ error, feedback, draft: null, saved: false });
  const missing = await missingKeyMessage((await getAiConfig()).provider);
  if (missing) return failed(missing);
  try {
    const { conversation: _c, leadId: _l, ...draft } = await draftLesson({ messageId, feedback });
    return { error: null, feedback, draft, saved: false };
  } catch (e) {
    if (e instanceof DomainError) return failed(e.message);
    console.error("[aprendizajes] redactar regla:", e);
    return failed("La IA no pudo redactar la regla. Intenta de nuevo.");
  }
}

/** Paso 2: guarda la regla (editada o no) como aprendizaje pendiente de aprobación. */
export async function saveLessonAction(leadId: string, messageId: string, prev: CorrectionState, form: FormData): Promise<CorrectionState> {
  const user = await authorizeAiMessage(leadId, messageId);
  const str = (key: string) => String(form.get(key) ?? "");
  try {
    await createLesson({
      messageId,
      rule: str("rule"),
      goodExample: str("goodExample"),
      badExample: str("badExample"),
      feedback: str("feedback"),
      conflict: str("conflict"),
      createdBy: user.name,
    });
  } catch (e) {
    if (e instanceof DomainError) return { ...prev, error: e.message };
    throw e;
  }
  revalidatePath("/settings/lessons");
  return { ...prev, error: null, saved: true };
}

/** Bloquea al contacto: cierra sus leads abiertos y descarta sus mensajes nuevos. */
export async function blockContactAction(leadId: string, form: FormData) {
  const { by } = await authorize(leadId);
  await blockContact(leadId, by, String(form.get("reason") ?? ""));
  done(leadId);
}

export async function unblockContactAction(leadId: string) {
  const { by } = await authorize(leadId);
  await unblockContact(leadId, by);
  done(leadId);
}

/** Vuelve a incluir en los envíos masivos a quien había pedido la baja. */
export async function optBackInAction(leadId: string) {
  const { by } = await authorize(leadId);
  await optBackIn(leadId, by);
  done(leadId);
}

/** Contactos duplicados del lead (mismo teléfono o correo), para fusionarlos desde su ficha. */
export async function leadDuplicatesAction(leadId: string) {
  await requireAdmin();
  const { lead } = await authorize(leadId);
  const contacts = (await findDuplicatesOf(lead.contactId)).map((c) => ({
    id: c.id,
    name: c.name,
    detail: [c.phone, c.email].filter(Boolean).join(" · "),
    leads: c.leads,
  }));
  // Los leads anteriores del mismo contacto salen como chats aparte, pero no son duplicados.
  const otherLeads = await db.lead.count({ where: { contactId: lead.contactId, id: { not: leadId } } });
  return { contacts, otherLeads };
}

/** Fusiona en el contacto del lead los duplicados elegidos. */
export async function mergeIntoLeadAction(leadId: string, otherIds: string[]): Promise<string | null> {
  const user = await requireAdmin();
  const { lead } = await authorize(leadId);
  try {
    await mergeContacts(lead.contactId, otherIds, { actor: "USER", userId: user.id });
  } catch (e) {
    if (e instanceof DomainError) return e.message;
    throw e;
  }
  done(leadId);
  revalidatePath("/settings/contacts");
  return null;
}

export type DraftReplyResult = { draft: string; error?: undefined } | { draft?: undefined; error: string };

/** "@ia" en el chat: la IA redacta el próximo mensaje del ejecutivo; vuelve al campo sin enviarse. */
export async function draftReplyAction(leadId: string, hint: string): Promise<DraftReplyResult> {
  const { user } = await authorize(leadId);
  const missing = await missingKeyMessage((await getAiConfig()).provider);
  if (missing) return { error: missing };
  try {
    return { draft: await draftExecutiveReply(leadId, user.name, hint) };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    console.error("[redactar] lead", leadId, e);
    return { error: "La IA no pudo redactar la respuesta. Intenta de nuevo en un momento." };
  }
}
