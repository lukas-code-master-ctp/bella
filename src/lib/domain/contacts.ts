import type { Channel } from "@prisma/client";
import { db } from "../db";
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
    where: { channel_externalId: { channel, externalId } },
    select: { blockedAt: true },
  });
  return Boolean(contact?.blockedAt);
}
