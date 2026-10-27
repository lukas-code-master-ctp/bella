"use server";

import { revalidatePath } from "next/cache";
import { canAccessLead, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  answerCall,
  callOption,
  callsForUser,
  hangUpCall,
  rejectCall,
  requestCallPermission,
  startCall,
  type CallOption,
} from "@/lib/domain/calls";
import { DomainError } from "@/lib/domain/leads";

/** El lead es de esta empresa y quien tiene la sesión lo puede ver (un ejecutivo, solo los suyos). */
async function leadAccessible(leadId: string) {
  const user = await requireUser();
  const lead = await db.lead.findUnique({ where: { id: leadId }, select: { assigneeId: true } });
  return Boolean(lead && canAccessLead(user, lead));
}

/** Llamadas que le suenan a quien tiene la sesión abierta y estado de la que está atendiendo. */
export async function myCallsAction(currentCallId: string | null) {
  const user = await requireUser();
  return callsForUser(user.id, currentCallId);
}

/** Contesta con la respuesta de audio (SDP) que armó el navegador. Devuelve el error si no se pudo. */
export async function answerCallAction(callId: string, sdp: string): Promise<string | null> {
  const user = await requireUser();
  try {
    await answerCall(callId, user.id, sdp);
    return null;
  } catch (e) {
    if (e instanceof DomainError) return e.message;
    throw e;
  }
}

export async function rejectCallAction(callId: string) {
  const user = await requireUser();
  await rejectCall(callId, user.id);
}

export async function hangUpCallAction(callId: string) {
  const user = await requireUser();
  await hangUpCall(callId, user.id).catch((err) => console.error("[llamadas] cortar:", err));
}

/** Botón de llamar en el chat: si se puede llamar ya, pedir permiso, o por qué no. */
export async function callOptionAction(leadId: string): Promise<CallOption> {
  await requireUser();
  if (!(await leadAccessible(leadId))) return { kind: "unavailable", reason: "No tienes acceso a este lead." };
  return callOption(leadId);
}

export async function requestCallPermissionAction(leadId: string): Promise<string | null> {
  const user = await requireUser();
  if (!(await leadAccessible(leadId))) return "No tienes acceso a este lead.";
  try {
    await requestCallPermission(leadId, user.id);
    revalidatePath(`/leads/${leadId}`);
    return null;
  } catch (e) {
    if (e instanceof DomainError) return e.message;
    throw e;
  }
}

/** Llama al cliente con la oferta de audio del navegador. */
export async function startCallAction(leadId: string, sdp: string): Promise<{ callId: string } | { error: string }> {
  const user = await requireUser();
  if (!(await leadAccessible(leadId))) return { error: "No tienes acceso a este lead." };
  try {
    return { callId: await startCall(leadId, user.id, sdp) };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
}
