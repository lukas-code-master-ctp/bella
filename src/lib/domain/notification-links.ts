/** Aviso de una regla que propuso un ejecutivo: no lleva al lead sino a Aprendizajes. */
export const LESSON_PENDING = "LESSON_PENDING";

/** Adónde lleva un aviso (en Avisos, el push y el correo). */
export function notificationUrl(n: { type: string; leadId: string }) {
  return n.type === LESSON_PENDING ? "/settings/lessons" : `/leads/${n.leadId}`;
}

/** Avisos que se agrupan en uno en la página Avisos: los de un mismo lead, o todas las reglas por revisar. */
export function notificationKey(n: { type: string; leadId: string }) {
  return n.type === LESSON_PENDING ? LESSON_PENDING : n.leadId;
}
