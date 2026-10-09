"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { canAccessLead, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAiConfig, missingKeyMessage } from "@/lib/ai/config";
import { runAgent } from "@/lib/ai/agent";
import { sendFollowUpNow } from "@/lib/ai/follow-ups";
import { cancelFollowUp } from "@/lib/domain/follow-ups";
import { refreshLeadInsights } from "@/lib/ai/insights";
import { loadRunView } from "@/lib/ai/trace";
import { setContactFields } from "@/lib/domain/fields";
import {
  addTag,
  closeLead,
  DomainError,
  moveStage,
  removeTag,
  reopenLead,
  setAiEnabled,
  setAssignee,
} from "@/lib/domain/leads";
import { receiveContactAudio } from "@/lib/domain/messages";
import { notifyContactMessage } from "@/lib/domain/notifications";
import { BLOB_MISSING } from "@/lib/media";

async function authorize(leadId: string) {
  const user = await requireUser();
  const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId }, include: { contact: true } });
  if (!canAccessLead(user, lead)) throw new Error("Sin acceso a este lead.");
  return { user, lead, by: { actor: "USER" as const, userId: user.id } };
}

function done(leadId: string) {
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/funnel");
}

/** Recalcula el resumen y el puntaje después de responder, sin demorar la respuesta. */
function refreshInsightsLater(leadId: string) {
  after(() => refreshLeadInsights(leadId));
}

/** Simulador: escribe (o manda una nota de voz) como si fueras el cliente y deja que la IA responda. */
export async function sendAsContactAction(leadId: string, _prev: string | null, form: FormData) {
  const { lead } = await authorize(leadId);
  if (lead.contact.channel !== "SIMULATOR") return "Solo disponible en leads del simulador.";
  const body = String(form.get("body") ?? "").trim();
  const audio = form.get("audio");
  if (audio instanceof File && audio.size > 0) {
    try {
      await receiveContactAudio(leadId, {
        bytes: new Uint8Array(await audio.arrayBuffer()),
        mimeType: audio.type,
        fileName: audio.name,
      });
    } catch (e) {
      if (e instanceof DomainError) return e.message;
      console.error(e);
      return e instanceof Error && e.message === BLOB_MISSING
        ? e.message
        : "No se pudo guardar el audio. Intenta de nuevo.";
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
    const missing = missingKeyMessage((await getAiConfig()).provider);
    if (missing) {
      done(leadId);
      return missing;
    }
    await runAgent(leadId);
  }
  refreshInsightsLater(leadId);
  done(leadId);
  return null;
}

/** Respuesta de un ejecutivo. Al responder, el ejecutivo toma la conversación y la IA se pausa. */
export async function sendAsUserAction(leadId: string, form: FormData) {
  const { user, lead, by } = await authorize(leadId);
  const body = String(form.get("body") ?? "").trim();
  if (!body) return;
  await db.message.create({ data: { leadId, author: "USER", userId: user.id, body } });
  if (lead.aiEnabled) await setAiEnabled(leadId, false, by);
  refreshInsightsLater(leadId);
  done(leadId);
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

export async function toggleAiAction(leadId: string, enabled: boolean) {
  const { by } = await authorize(leadId);
  await setAiEnabled(leadId, enabled, by);
  if (enabled) {
    await runAgent(leadId).catch((e) => console.error(e));
    refreshInsightsLater(leadId);
  }
  done(leadId);
}

/** Pide a la IA el seguimiento del lead ahora (para no esperar el plazo, ej. al probar). */
export async function sendFollowUpNowAction(leadId: string, _prev: string | null): Promise<string | null> {
  const { lead } = await authorize(leadId);
  if (!lead.aiEnabled || lead.status !== "OPEN") return "La IA debe estar activa en un lead abierto.";
  const missing = missingKeyMessage((await getAiConfig()).provider);
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
