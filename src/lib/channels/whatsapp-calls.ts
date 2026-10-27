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
};

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
};
