import type { Channel } from "@prisma/client";
import { normalize } from "../text";
import { db } from "../db";
import { currentCompanyId } from "../tenant";
import type { ActorRef } from "./leads";

/** Motivo de pérdida con el que se cierran los leads abiertos de un contacto al bloquearlo. */
export const BLOCKED_LOST_REASON = "Contacto bloqueado";

/**
 * Bloquea al contacto del lead (spam, mensajes personales, postulantes): sus leads abiertos se
 * cierran como perdidos y, desde ahora, sus mensajes nuevos se descartan sin crear leads, sin
 * avisos y sin respuesta de la IA. El equipo tampoco puede escribirle.
 */
export async function blockContact(leadId: string, by: ActorRef, reason?: string | null) {
  const note = reason?.trim() || null;
  await db.$transaction(async (tx) => {
    const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
    await tx.contact.update({
      where: { id: lead.contactId },
      data: { blockedAt: new Date(), blockedReason: note },
    });
    const open = await tx.lead.findMany({ where: { contactId: lead.contactId, status: "OPEN" } });
    await tx.lead.updateMany({
      where: { id: { in: open.map((l) => l.id) } },
      data: { status: "LOST", lostReason: BLOCKED_LOST_REASON, closedAt: new Date(), aiEnabled: false, followUpAt: null },
    });
    for (const l of open) {
      await tx.leadEvent.create({
        data: { leadId: l.id, type: "LOST", actor: by.actor, userId: by.userId ?? null, reason: BLOCKED_LOST_REASON, data: {} },
      });
    }
    await tx.leadEvent.create({
      data: { leadId, type: "BLOCKED", actor: by.actor, userId: by.userId ?? null, reason: note },
    });
  });
}

/** Quita el bloqueo: los mensajes nuevos vuelven a entrar. Los leads cerrados siguen cerrados. */
export async function unblockContact(leadId: string, by: ActorRef) {
  await db.$transaction(async (tx) => {
    const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
    await tx.contact.update({ where: { id: lead.contactId }, data: { blockedAt: null, blockedReason: null } });
    await tx.leadEvent.create({ data: { leadId, type: "UNBLOCKED", actor: by.actor, userId: by.userId ?? null } });
  });
}

/** Si el contacto de ese canal está bloqueado (sus mensajes entrantes se descartan). */
export async function isBlocked(channel: Channel, externalId: string) {
  const contact = await db.contact.findUnique({
    where: { companyId_channel_externalId: { companyId: await currentCompanyId(), channel, externalId } },
    select: { blockedAt: true },
  });
  return Boolean(contact?.blockedAt);
}

/**
 * Frases con las que alguien pide no recibir más envíos masivos. Tiene que ser el mensaje entero
 * (sin saludo ni "gracias"): "no me interesa ese lote, ¿tienen otro?" no es una baja.
 */
const OPT_OUT_PHRASES = new Set([
  "baja",
  "dar de baja",
  "darme de baja",
  "de baja",
  "stop",
  "parar",
  "unsubscribe",
  "desuscribir",
  "desuscribirme",
  "cancelar suscripcion",
  "no me interesa",
  "no me interesan",
  "ya no me interesa",
  "no estoy interesado",
  "no estoy interesada",
  "no quiero recibir mas mensajes",
  "no quiero recibir mensajes",
  "no quiero mas mensajes",
  "no me envien mas mensajes",
  "no me manden mas mensajes",
  "no me escriban mas",
  "no me escriban",
]);

const COURTESY = /^(hola|buenas|buenos dias|buenas tardes|buenas noches)\s+|\s+(gracias|muchas gracias|por favor|porfa|saludos)$|^(gracias|muchas gracias|por favor)\s+/;

export function isOptOutMessage(text: string): boolean {
  let t = normalize(text);
  for (let i = 0; i < 3; i++) t = t.replace(COURTESY, "").trim();
  return OPT_OUT_PHRASES.has(t);
}

/** Si el mensaje del cliente pide la baja, su contacto queda fuera de los envíos masivos. */
export async function optOutIfAsked(leadId: string, text: string): Promise<boolean> {
  if (!isOptOutMessage(text)) return false;
  const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId } });
  const { count } = await db.contact.updateMany({ where: { id: lead.contactId, optedOutAt: null }, data: { optedOutAt: new Date() } });
  if (count) await db.leadEvent.create({ data: { leadId, type: "OPTED_OUT", actor: "SYSTEM", reason: text.trim().slice(0, 200) } });
  return count > 0;
}

/** Vuelve a incluir al contacto en los envíos masivos (ej. pidió la baja por error). */
export async function optBackIn(leadId: string, by: ActorRef) {
  const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId } });
  const { count } = await db.contact.updateMany({ where: { id: lead.contactId, optedOutAt: { not: null } }, data: { optedOutAt: null } });
  if (count) await db.leadEvent.create({ data: { leadId, type: "OPTED_IN", actor: by.actor, userId: by.userId ?? null } });
}
