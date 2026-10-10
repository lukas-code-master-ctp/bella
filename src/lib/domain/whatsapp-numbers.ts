import { db } from "../db";
import { lookupWhatsAppNumber } from "../channels/whatsapp";
import { DomainError } from "./leads";

/**
 * Números de WhatsApp adicionales al de WHATSAPP_PHONE_NUMBER_ID, de la misma app de Meta. Cada
 * uno puede llevar sus leads nuevos a un embudo; las respuestas salen por el número al que el
 * cliente escribió (Contact.waPhoneNumberId).
 */

export type NumberLookup = typeof lookupWhatsAppNumber;

export function listWhatsAppNumbers() {
  return db.whatsAppNumber.findMany({ orderBy: { createdAt: "asc" }, include: { funnel: true } });
}

/** phone_number_id que Bella atiende: el de las variables de entorno y los agregados. */
export async function whatsappPhoneIds(): Promise<string[]> {
  const extra = await db.whatsAppNumber.findMany({ select: { phoneNumberId: true } });
  const env = process.env.WHATSAPP_PHONE_NUMBER_ID;
  return [...new Set([...(env ? [env] : []), ...extra.map((n) => n.phoneNumberId)])];
}

/** Embudo de los leads nuevos que escriben a ese número, si tiene uno. */
export async function funnelForNumber(phoneNumberId: string | undefined): Promise<string | null> {
  if (!phoneNumberId) return null;
  const n = await db.whatsAppNumber.findUnique({ where: { phoneNumberId }, select: { funnelId: true } });
  return n?.funnelId ?? null;
}

function cleanFunnel(funnelId: string | null | undefined) {
  return funnelId?.trim() || null;
}

/** Agrega un número tras confirmar con Meta que el token tiene acceso a él. */
export async function addWhatsAppNumber(
  input: { phoneNumberId: string; label: string; funnelId?: string | null },
  lookup: NumberLookup = lookupWhatsAppNumber,
) {
  const phoneNumberId = input.phoneNumberId.trim();
  if (!/^\d+$/.test(phoneNumberId)) throw new DomainError("El id del número son solo dígitos (no es el número de teléfono).");
  if (phoneNumberId === process.env.WHATSAPP_PHONE_NUMBER_ID) throw new DomainError("Ese es el número principal: ya está conectado.");
  if (await db.whatsAppNumber.findUnique({ where: { phoneNumberId } })) throw new DomainError("Ese número ya está agregado.");
  const info = await lookup(phoneNumberId);
  return db.whatsAppNumber.create({
    data: {
      phoneNumberId,
      label: input.label.trim() || info.name || info.displayPhone,
      displayPhone: info.displayPhone,
      funnelId: cleanFunnel(input.funnelId),
    },
  });
}

export function updateWhatsAppNumber(id: string, input: { label: string; funnelId?: string | null }) {
  const label = input.label.trim();
  return db.whatsAppNumber.update({
    where: { id },
    data: { ...(label ? { label } : {}), funnelId: cleanFunnel(input.funnelId) },
  });
}

/** Quitar un número deja de recibir sus mensajes; sus contactos vuelven a responderse por el principal. */
export async function deleteWhatsAppNumber(id: string) {
  const n = await db.whatsAppNumber.delete({ where: { id } });
  await db.contact.updateMany({ where: { waPhoneNumberId: n.phoneNumberId }, data: { waPhoneNumberId: null } });
}
