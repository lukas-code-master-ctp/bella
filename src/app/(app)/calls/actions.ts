"use server";

import { requireUser } from "@/lib/auth";
import { answerCall, callsForUser, hangUpCall, rejectCall } from "@/lib/domain/calls";
import { DomainError } from "@/lib/domain/leads";

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
