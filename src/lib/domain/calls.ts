import { db } from "../db";
import { getSetting, setSetting } from "../settings";
import { deliverPendingPush } from "../push";
import { webhookValues, type WaCall, type WaWebhook } from "../channels/whatsapp";
import { ChannelSendError } from "../channels/whatsapp";
import { callingApi, type CallingApi } from "../channels/whatsapp-calls";
import { replyWindowClosed } from "./reply-window";
import { openLeadFor } from "./channels";
import { isBlocked } from "./contacts";
import { DomainError } from "./leads";
import { notifyCallTx } from "./notifications";
import { funnelForNumber, whatsappPhoneIds } from "./whatsapp-numbers";

/**
 * Llamadas de WhatsApp. El cliente toca "llamar" en WhatsApp, Meta avisa al webhook (campo `calls`)
 * con la oferta de audio y Beliapp la hace sonar en el navegador del ejecutivo del lead (o de los
 * administradores, si no tiene). Quien contesta arma la respuesta de audio en su navegador y
 * Beliapp se la pasa a Meta. Meta da entre 30 y 60 segundos para contestar.
 */

/** Recibir llamadas: apagado por defecto. Al prenderlo se activa el botón de llamar en cada número. */
export type CallSettings = { enabled: boolean };

export const DEFAULT_CALLS: CallSettings = { enabled: false };

/** Una llamada que sigue sonando después de esto ya la cortó WhatsApp por falta de respuesta. */
export const RING_TIMEOUT_MS = 60_000;

export async function getCallSettings(): Promise<CallSettings> {
  return { ...DEFAULT_CALLS, ...(await getSetting<Partial<CallSettings>>("calls", {})) };
}

/**
 * Prende o apaga las llamadas en Meta para todos los números de la empresa y lo guarda. Al prender,
 * si Meta rechaza algún número (por ejemplo, porque su límite de mensajería es menor a 2.000), no
 * se guarda y se explica el motivo.
 */
export async function saveCallSettings(s: CallSettings, api: CallingApi = callingApi) {
  const numbers = await whatsappPhoneIds();
  if (s.enabled && !numbers.length) throw new DomainError("Primero conecta un número de WhatsApp.");
  for (const id of numbers) {
    try {
      await api.setCalling(id, s.enabled);
    } catch (err) {
      // Al apagar se guarda igual: Beliapp rechaza las llamadas que lleguen.
      if (s.enabled) {
        await Promise.all(numbers.map((n) => api.setCalling(n, false).catch(() => null)));
        throw new DomainError(`Meta no activó las llamadas: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  await setSetting("calls", s);
}

const callStatus = (c: WaCall) => String(Array.isArray(c.status) ? c.status[0] : (c.status ?? "")).toUpperCase();

/** Procesa los avisos de llamadas del webhook de WhatsApp. */
export async function receiveWhatsAppCalls(payload: WaWebhook, api: CallingApi = callingApi) {
  const values = webhookValues(payload, await whatsappPhoneIds(), "calls");
  if (!values.length) return;
  const { enabled } = await getCallSettings();
  for (const value of values) {
    const phoneNumberId = value.metadata?.phone_number_id;
    if (!phoneNumberId) continue;
    const names = new Map((value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
    for (const c of value.calls ?? []) {
      if (c.event === "connect" && c.direction === "BUSINESS_INITIATED") {
        // El cliente se conectó a la llamada que hizo la empresa: su respuesta de audio va al navegador.
        if (c.session?.sdp) await db.call.updateMany({ where: { externalId: c.id }, data: { sdpAnswer: c.session.sdp } });
      } else if (c.event === "connect") {
        await incomingCall(c, phoneNumberId, names.get(c.from ?? ""), enabled, api);
      } else if (c.event === "terminate") {
        await callEnded(c);
      }
    }
    for (const s of value.statuses ?? []) {
      if (s.type !== "call") continue;
      const status = s.status.toUpperCase();
      if (status === "ACCEPTED") {
        await db.call.updateMany({ where: { externalId: s.id, status: "RINGING" }, data: { status: "ANSWERED", answeredAt: new Date() } });
      } else if (status === "REJECTED") {
        await db.call.updateMany({ where: { externalId: s.id, status: "RINGING" }, data: { status: "REJECTED" } });
      }
    }
  }
  await deliverPendingPush();
}

async function incomingCall(c: WaCall, phoneNumberId: string, profileName: string | undefined, enabled: boolean, api: CallingApi) {
  const from = c.from;
  if (!from || !c.session?.sdp) return;
  if (await db.call.findFirst({ where: { externalId: c.id } })) return;
  // Apagadas en Beliapp (o contacto bloqueado): se rechaza para que no quede sonando sin nadie que conteste.
  if (!enabled || (await isBlocked("WHATSAPP", from))) {
    await api.reject(phoneNumberId, c.id).catch((err) => console.error("[llamadas] rechazar:", err));
    return;
  }
  const leadId = await openLeadFor(
    "WHATSAPP",
    from,
    async () => profileName?.trim() || `+${from}`,
    false,
    `+${from}`,
    () => funnelForNumber(phoneNumberId),
  );
  await db.$transaction(async (tx) => {
    const ringUserIds = await notifyCallTx(tx, leadId, "Te está llamando por WhatsApp");
    await tx.call.create({ data: { leadId, externalId: c.id, phoneNumberId, sdpOffer: c.session!.sdp, ringUserIds } });
  });
}

/** WhatsApp avisa que la llamada terminó: queda la nota en el chat y, si nadie contestó, el aviso de perdida. */
async function callEnded(c: WaCall) {
  const call = await db.call.findFirst({ where: { externalId: c.id }, include: { answeredBy: true } });
  if (!call) return;
  const duration = Number(c.duration);
  const failed = callStatus(c) === "FAILED";
  const error = c.errors?.[0]?.error_data?.details || c.errors?.[0]?.message || null;
  const outbound = call.direction === "OUTBOUND";
  await db.$transaction(async (tx) => {
    const answered = call.status === "ANSWERED";
    const status = answered ? "ENDED" : failed && call.status === "RINGING" ? "FAILED" : outbound && call.status === "REJECTED" ? "REJECTED" : "MISSED";
    // Solo una vez: si Meta repite el aviso o el ejecutivo ya la rechazó, no se anota de nuevo. En una
    // saliente, el rechazo del cliente llega antes como estado y la nota se deja al terminar.
    const done = await tx.call.updateMany({
      where: { id: call.id, status: { in: outbound ? ["RINGING", "ANSWERED", "REJECTED"] : ["RINGING", "ANSWERED"] }, endedAt: null },
      data: {
        status,
        endedAt: c.end_time ? new Date(Number(c.end_time) * 1000) : new Date(),
        durationSec: Number.isFinite(duration) ? Math.round(duration) : null,
        error,
      },
    });
    if (!done.count) return;
    if (answered) {
      await tx.leadEvent.create({
        data: {
          leadId: call.leadId,
          type: "CALL_ENDED",
          actor: "SYSTEM",
          userId: call.answeredById,
          data: { direction: call.direction, duration: Number.isFinite(duration) ? Math.round(duration) : null, userName: call.answeredBy?.name ?? null },
        },
      });
      return;
    }
    if (outbound) {
      await tx.leadEvent.create({
        data: {
          leadId: call.leadId,
          type: "CALL_MISSED",
          actor: "SYSTEM",
          userId: call.answeredById,
          data: { direction: call.direction, userName: call.answeredBy?.name ?? null, declined: status === "REJECTED", error },
        },
      });
      return;
    }
    await tx.leadEvent.create({
      data: { leadId: call.leadId, type: "CALL_MISSED", actor: "SYSTEM", data: { direction: call.direction, error } },
    });
    await notifyCallTx(tx, call.leadId, "Llamada perdida por WhatsApp", call.ringUserIds.length ? call.ringUserIds : undefined);
  });
}

export type RingingCall = { id: string; leadId: string; name: string; phone: string | null; sdpOffer: string; createdAt: string };

/**
 * Lo que el navegador de esa persona necesita saber: las llamadas que le están sonando y, si está
 * en una, si sigue en curso.
 */
export async function callsForUser(userId: string, currentCallId?: string | null, now = new Date()) {
  const ringing = await db.call.findMany({
    where: { status: "RINGING", ringUserIds: { has: userId }, createdAt: { gt: new Date(now.getTime() - RING_TIMEOUT_MS) } },
    include: { lead: { include: { contact: true } } },
    orderBy: { createdAt: "asc" },
  });
  const current = currentCallId
    ? await db.call.findFirst({ where: { id: currentCallId, answeredById: userId }, select: { status: true, sdpAnswer: true } })
    : null;
  return {
    ringing: ringing.map(
      (c): RingingCall => ({
        id: c.id,
        leadId: c.leadId,
        name: c.lead.contact.name,
        phone: c.lead.contact.phone,
        sdpOffer: c.sdpOffer ?? "",
        createdAt: c.createdAt.toISOString(),
      }),
    ),
    currentStatus: current?.status ?? null,
    /** En una llamada saliente: la respuesta de audio del cliente, cuando ya se conectó. */
    currentAnswer: current?.sdpAnswer ?? null,
  };
}

async function ringingFor(callId: string, userId: string) {
  const call = await db.call.findFirst({ where: { id: callId, ringUserIds: { has: userId } } });
  if (!call) throw new DomainError("Esa llamada no existe.");
  return call;
}

/** Contesta con la respuesta de audio del navegador. Si otra persona contestó antes, avisa. */
export async function answerCall(callId: string, userId: string, sdp: string, api: CallingApi = callingApi) {
  const call = await ringingFor(callId, userId);
  if (!sdp.trim()) throw new DomainError("El navegador no pudo preparar el audio de la llamada.");
  const taken = await db.call.updateMany({
    where: { id: call.id, status: "RINGING", answeredById: null },
    data: { answeredById: userId },
  });
  if (!taken.count) throw new DomainError("La llamada ya no está sonando: la contestó otra persona o el cliente cortó.");
  try {
    await api.accept(call.phoneNumberId, call.externalId, sdp);
  } catch (err) {
    await db.call.update({ where: { id: call.id }, data: { status: "FAILED", error: err instanceof Error ? err.message : String(err) } });
    throw err instanceof DomainError ? err : new DomainError(err instanceof Error ? err.message : String(err));
  }
  await db.call.update({ where: { id: call.id }, data: { status: "ANSWERED", answeredAt: new Date() } });
  // Ya se atendió: el aviso de "te está llamando" deja de estar pendiente para todos.
  await db.notification.updateMany({
    where: { leadId: call.leadId, type: "CALL", readAt: null, userId: { in: call.ringUserIds } },
    data: { readAt: new Date() },
  });
}

/** Rechaza la llamada para todos: queda como perdida en el chat. */
export async function rejectCall(callId: string, userId: string, api: CallingApi = callingApi) {
  const call = await ringingFor(callId, userId);
  const done = await db.call.updateMany({ where: { id: call.id, status: "RINGING" }, data: { status: "REJECTED", endedAt: new Date() } });
  if (!done.count) return;
  await api.reject(call.phoneNumberId, call.externalId).catch((err) => console.error("[llamadas] rechazar:", err));
  const user = await db.user.findUnique({ where: { id: userId } });
  await db.leadEvent.create({
    data: { leadId: call.leadId, type: "CALL_MISSED", actor: "USER", userId, data: { direction: call.direction, rejectedBy: user?.name ?? null } },
  });
}

/** Corta la llamada en curso. La nota con la duración queda cuando WhatsApp confirma el término. */
export async function hangUpCall(callId: string, userId: string, api: CallingApi = callingApi) {
  const call = await db.call.findFirst({ where: { id: callId, answeredById: userId } });
  if (!call) return;
  // Una saliente se puede cortar mientras suena.
  if (call.status !== "ANSWERED" && !(call.direction === "OUTBOUND" && call.status === "RINGING")) return;
  await api.terminate(call.phoneNumberId, call.externalId);
}

// --- Llamar al cliente ---------------------------------------------------------------------

/** Texto que acompaña la solicitud de permiso; WhatsApp agrega los botones para aceptar o no. */
export const PERMISSION_REQUEST_TEXT = "¿Te podemos llamar por WhatsApp para conversarlo mejor?";

/** Lo que el chat necesita para el botón de llamar: si se puede llamar ya, o pedir permiso. */
export type CallOption =
  | { kind: "call" }
  | { kind: "request" }
  | { kind: "unavailable"; reason: string };

async function whatsappLead(leadId: string) {
  const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId }, include: { contact: true } });
  const { channel, externalId, waPhoneNumberId, blockedAt } = lead.contact;
  if (channel !== "WHATSAPP" || !externalId) throw new DomainError("Solo se puede llamar a leads de WhatsApp.");
  if (blockedAt) throw new DomainError("El contacto está bloqueado.");
  if (!(await getCallSettings()).enabled) throw new DomainError("Las llamadas están apagadas en Configuración → Canales → WhatsApp.");
  const phoneNumberId = waPhoneNumberId || (await whatsappPhoneIds())[0];
  if (!phoneNumberId) throw new DomainError("Primero conecta un número de WhatsApp.");
  return { lead, to: externalId, phoneNumberId };
}

/** Pregunta a Meta si el cliente dio permiso para llamarlo y, si no, si hoy se le puede pedir. */
export async function callOption(leadId: string, api: CallingApi = callingApi): Promise<CallOption> {
  try {
    const { to, phoneNumberId } = await whatsappLead(leadId);
    const p = await api.permission(phoneNumberId, to);
    if (p.canCall) return { kind: "call" };
    if (p.status !== "no_permission") {
      return { kind: "unavailable", reason: "WhatsApp no deja llamar a este cliente por ahora (llegaste al límite de llamadas de hoy)." };
    }
    if (!p.canRequest) {
      return { kind: "unavailable", reason: "El cliente no ha dado permiso y ya se le pidió hace poco (WhatsApp deja pedirlo 1 vez al día y 2 a la semana)." };
    }
    if (await replyWindowClosed(leadId)) {
      return { kind: "unavailable", reason: "El cliente no ha dado permiso, y para pedírselo tiene que haber escrito en las últimas 24 horas." };
    }
    return { kind: "request" };
  } catch (err) {
    if (err instanceof DomainError || err instanceof ChannelSendError) return { kind: "unavailable", reason: err.message };
    throw err;
  }
}

/** Manda al cliente la solicitud de permiso para llamarlo; queda en el chat como mensaje del ejecutivo. */
export async function requestCallPermission(leadId: string, userId: string, api: CallingApi = callingApi) {
  const { to, phoneNumberId } = await whatsappLead(leadId);
  if (await replyWindowClosed(leadId)) throw new DomainError("Para pedir permiso el cliente tiene que haber escrito en las últimas 24 horas.");
  let externalId: string;
  try {
    externalId = await api.requestPermission(phoneNumberId, to, PERMISSION_REQUEST_TEXT);
  } catch (err) {
    throw new DomainError(err instanceof Error ? err.message : String(err));
  }
  await db.message.create({
    data: { leadId, author: "USER", userId, body: `${PERMISSION_REQUEST_TEXT} [Solicitud de llamada]`, externalId, deliveryStatus: "SENT" },
  });
}

/** Llama al cliente con la oferta de audio del navegador de quien llama. Devuelve el id de la llamada en Beliapp. */
export async function startCall(leadId: string, userId: string, sdp: string, api: CallingApi = callingApi): Promise<string> {
  const { to, phoneNumberId } = await whatsappLead(leadId);
  if (!sdp.trim()) throw new DomainError("El navegador no pudo preparar el audio de la llamada.");
  let externalId: string;
  try {
    externalId = await api.connect(phoneNumberId, to, sdp);
  } catch (err) {
    throw new DomainError(err instanceof Error ? err.message : String(err));
  }
  const call = await db.call.create({
    data: { leadId, externalId, direction: "OUTBOUND", phoneNumberId, answeredById: userId },
  });
  return call.id;
}
