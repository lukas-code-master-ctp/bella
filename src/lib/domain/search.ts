import type { Channel, LeadStatus } from "@prisma/client";
import { db } from "@/lib/db";

export type SearchHit = {
  id: string;
  name: string;
  /** Teléfono o correo, el que coincidió primero. */
  detail: string;
  stage: string;
  status: LeadStatus;
  channel: Channel;
};

/**
 * Búsqueda global de la barra superior: leads cuyo contacto calza por nombre, correo o teléfono
 * (sin importar espacios ni el +). Primero los abiertos y, dentro de eso, los más nuevos.
 * `assigneeId` limita a los leads de un ejecutivo (los que puede abrir).
 */
export async function searchLeads(query: string, scope: { assigneeId?: string } = {}): Promise<SearchHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const digits = q.replace(/\D/g, "");
  const leads = await db.lead.findMany({
    where: {
      ...scope,
      contact: {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          ...(digits.length >= 3 ? [{ phone: { contains: digits } }, { externalId: { contains: digits } }] : []),
        ],
      },
    },
    include: { contact: true, stage: { select: { name: true } } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 8,
  });
  return leads.map((l) => ({
    id: l.id,
    name: l.contact.name,
    detail: l.contact.phone ?? (l.contact.channel === "WHATSAPP" && l.contact.externalId ? `+${l.contact.externalId}` : null) ?? l.contact.email ?? "",
    stage: l.stage.name,
    status: l.status,
    channel: l.contact.channel,
  }));
}
