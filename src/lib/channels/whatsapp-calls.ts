import { graph } from "./whatsapp";

/**
 * Llamadas de WhatsApp (Cloud API Calling). La señalización va por la Graph API y el webhook
 * (campo `calls`); el audio va directo por WebRTC entre WhatsApp y el navegador de quien contesta.
 * Meta pide que el número tenga un límite de mensajería de 2.000 o más para activarlas.
 */
export type CallingApi = {
  /** Muestra (o esconde) el botón de llamar del número en WhatsApp. */
  setCalling(phoneNumberId: string, enabled: boolean): Promise<void>;
  /** Conecta la llamada con la respuesta de audio (SDP) del navegador. */
  accept(phoneNumberId: string, callId: string, sdp: string): Promise<void>;
  reject(phoneNumberId: string, callId: string): Promise<void>;
  /** Corta una llamada en curso (Meta cobra por duración: hay que avisar siempre). */
  terminate(phoneNumberId: string, callId: string): Promise<void>;
  /** Llama al cliente con la oferta de audio (SDP) del navegador. Devuelve el id de la llamada. */
  connect(phoneNumberId: string, to: string, sdp: string): Promise<string>;
  /** Si el cliente dio permiso para llamarlo y si hoy se le puede pedir. */
  permission(phoneNumberId: string, waId: string): Promise<CallPermission>;
  /** Le pide al cliente permiso para llamarlo (solo dentro de las 24 h). Devuelve el id del mensaje. */
  requestPermission(phoneNumberId: string, to: string, body: string): Promise<string>;
};

export type CallPermission = {
  /** no_permission, temporary o permanent. */
  status: string;
  canCall: boolean;
  canRequest: boolean;
};

/** El cliente no ha dado permiso para que lo llamen (o ya venció). */
export const NO_CALL_PERMISSION = 138006;

const callAction = (phoneNumberId: string, body: Record<string, unknown>) =>
  graph(
    `${encodeURIComponent(phoneNumberId)}/calls`,
    { method: "POST", body: JSON.stringify({ messaging_product: "whatsapp", ...body }) },
    "la llamada",
  );

export const callingApi: CallingApi = {
  async setCalling(phoneNumberId, enabled) {
    const calling = enabled
      ? { status: "ENABLED", call_icon_visibility: "DEFAULT", callback_permission_status: "ENABLED" }
      : { status: "DISABLED" };
    await graph(
      `${encodeURIComponent(phoneNumberId)}/settings`,
      { method: "POST", body: JSON.stringify({ calling }) },
      "la configuración de llamadas",
    );
  },
  async accept(phoneNumberId, callId, sdp) {
    const session = { sdp_type: "answer", sdp };
    // pre_accept arma la conexión de audio antes de contestar, para no cortar las primeras palabras.
    await callAction(phoneNumberId, { call_id: callId, action: "pre_accept", session });
    await callAction(phoneNumberId, { call_id: callId, action: "accept", session });
  },
  async reject(phoneNumberId, callId) {
    await callAction(phoneNumberId, { call_id: callId, action: "reject" });
  },
  async terminate(phoneNumberId, callId) {
    await callAction(phoneNumberId, { call_id: callId, action: "terminate" });
  },
  async connect(phoneNumberId, to, sdp) {
    const res = (await callAction(phoneNumberId, { to, action: "connect", session: { sdp_type: "offer", sdp } })) as {
      calls?: { id: string }[];
    };
    const id = res.calls?.[0]?.id;
    if (!id) throw new Error("WhatsApp no devolvió el id de la llamada.");
    return id;
  },
  async permission(phoneNumberId, waId) {
    const res = await graph<{
      permission?: { status?: string };
      actions?: { action_name: string; can_perform_action: boolean }[];
    }>(`${encodeURIComponent(phoneNumberId)}/call_permissions?user_wa_id=${encodeURIComponent(waId)}`, {}, "la consulta del permiso de llamada");
    const can = (name: string) => Boolean(res.actions?.find((a) => a.action_name === name)?.can_perform_action);
    return { status: res.permission?.status ?? "no_permission", canCall: can("start_call"), canRequest: can("send_call_permission_request") };
  },
  async requestPermission(phoneNumberId, to, body) {
    const res = await graph<{ messages?: { id: string }[] }>(
      `${encodeURIComponent(phoneNumberId)}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "interactive",
          interactive: { type: "call_permission_request", action: { name: "call_permission_request" }, body: { text: body } },
        }),
      },
      "la solicitud de llamada",
    );
    const id = res.messages?.[0]?.id;
    if (!id) throw new Error("WhatsApp no devolvió el id del mensaje.");
    return id;
  },
};
