import { db } from "../db";
import { approvedTemplates, ChannelSendError, cloudApi, type ApprovedTemplate, type WhatsAppApi } from "../channels/whatsapp";
import { renderBody } from "./broadcasts";
import { replyWindowEnd } from "./follow-ups";
import { DomainError } from "./leads";

/**
 * Ventana de 24 h en el chat del lead: WhatsApp, Instagram y Messenger solo dejan escribirle
 * libremente al cliente hasta 24 h después de su último mensaje. Pasado eso, el ejecutivo no
 * puede mandar texto, audio ni archivos; en WhatsApp puede reactivar la conversación con una
 * plantilla aprobada en Meta.
 */

const WINDOW_CHANNELS = ["WHATSAPP", "INSTAGRAM", "FACEBOOK"];

export const WINDOW_CLOSED_ERROR =
  "Pasaron más de 24 horas desde el último mensaje del cliente: el canal solo deja escribirle con una plantilla aprobada.";

/** El canal del lead tiene ventana de 24 h y ya se cerró. */
export async function replyWindowClosed(leadId: string, now = new Date()): Promise<boolean> {
  const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId }, select: { contact: { select: { channel: true } } } });
  if (!WINDOW_CHANNELS.includes(lead.contact.channel)) return false;
  const end = await replyWindowEnd(db, leadId);
  return end !== null && end.getTime() <= now.getTime();
}

/** Plantilla que el ejecutivo puede elegir en el chat; `unsupported` explica por qué no, si no se puede. */
export type ChatTemplate = Pick<ApprovedTemplate, "name" | "language" | "category" | "body" | "params"> & { unsupported: string | null };

/** Plantillas aprobadas para mandar desde el chat (solo texto con {{1}}, {{2}}…). */
export async function chatTemplates(list: () => Promise<ApprovedTemplate[]> = approvedTemplates): Promise<ChatTemplate[]> {
  return (await list()).map((t) => ({
    name: t.name,
    language: t.language,
    category: t.category,
    body: t.body,
    params: t.params,
    unsupported:
      t.unsupported ??
      (t.header || t.urlButtons.length
        ? "Lleva un archivo o un enlace variable; por ahora se manda desde Envíos masivos."
        : null),
  }));
}

export type TemplateToSend = { name: string; language: string; params: string[] };

/**
 * Un ejecutivo manda una plantilla aprobada al cliente para retomar la conversación. El mensaje
 * queda en el chat con el texto ya llenado. Devuelve el motivo si WhatsApp no la aceptó.
 */
export async function sendLeadTemplate(
  leadId: string,
  userId: string,
  input: TemplateToSend,
  deps: { api?: WhatsAppApi; templates?: () => Promise<ApprovedTemplate[]> } = {},
): Promise<string | null> {
  const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId }, include: { contact: true } });
  const { channel, externalId: to, waPhoneNumberId } = lead.contact;
  if (channel !== "WHATSAPP") throw new DomainError("Las plantillas solo se pueden enviar por WhatsApp.");
  if (!to) throw new DomainError("El contacto no tiene número de WhatsApp.");
  const template = (await chatTemplates(deps.templates)).find((t) => t.name === input.name && t.language === input.language);
  if (!template) throw new DomainError("La plantilla ya no está aprobada en Meta. Elige otra.");
  if (template.unsupported) throw new DomainError(template.unsupported);
  const params = input.params.slice(0, template.params).map((p) => p.replace(/\s+/g, " ").trim());
  if (params.length < template.params || params.some((p) => !p)) throw new DomainError("Completa todas las variables de la plantilla.");

  const api = deps.api ?? cloudApi;
  if (!api.sendTemplate) throw new DomainError("Este canal no permite enviar plantillas.");
  const message = await db.message.create({
    data: { leadId, author: "USER", userId, body: renderBody(template.body, params), deliveryStatus: "SENDING" },
  });
  try {
    const externalId = await api.sendTemplate(to, { name: template.name, language: template.language, params }, waPhoneNumberId ?? undefined);
    await db.message.update({ where: { id: message.id }, data: { deliveryStatus: "SENT", externalId } });
    return null;
  } catch (err) {
    const reason = err instanceof ChannelSendError ? err.message : "No se pudo enviar la plantilla por WhatsApp.";
    if (!(err instanceof ChannelSendError)) console.error(`[plantilla] lead ${leadId}:`, err);
    await db.message.update({ where: { id: message.id }, data: { deliveryStatus: "FAILED", deliveryError: reason } });
    return reason;
  }
}
