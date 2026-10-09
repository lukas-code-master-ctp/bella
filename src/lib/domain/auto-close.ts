import { db } from "../db";
import { getSetting, setSetting } from "../settings";
import { closeLead } from "./leads";

export type AutoCloseSettings = {
  enabled: boolean;
  /** Días sin actividad (mensajes ni eventos) para cerrar el lead como perdido. */
  days: number;
  /** Motivo de pérdida que queda en el lead. */
  reason: string;
  /** Etapas cuyos leads se cierran como perdidos en la siguiente pasada, sin esperar inactividad. */
  lostStageIds: string[];
};

export type AutoCloseRun = { at: string; closed: number };

export const DEFAULT_AUTO_CLOSE: AutoCloseSettings = {
  enabled: false,
  days: 7,
  reason: "Sin respuesta del cliente",
  lostStageIds: [],
};

export async function getAutoCloseSettings(): Promise<AutoCloseSettings> {
  const saved = await getSetting<Partial<AutoCloseSettings>>("autoClose", {});
  return { ...DEFAULT_AUTO_CLOSE, ...saved };
}

/**
 * Cierra como perdidos los leads abiertos que:
 * - llevan `days` días sin actividad (último mensaje o evento, de quien sea) y cuyo último
 *   mensaje no es del cliente: un cliente sin respuesta es trabajo pendiente, no un lead perdido.
 *   Los seguimientos de reactivación son mensajes, así que reinician el plazo: solo se cierra
 *   cuando terminaron los intentos y pasó un plazo completo en silencio.
 * - están en una etapa marcada como de cierre (ej. "Perdidos"); el motivo es el que se dio al
 *   mover el lead a esa etapa, o el configurado.
 */
export async function runAutoClose(now = new Date()): Promise<number> {
  const settings = await getAutoCloseSettings();
  if (!settings.enabled) return 0;
  const cutoff = new Date(now.getTime() - settings.days * 24 * 60 * 60 * 1000);

  const inactive = await db.$queryRaw<{ id: string }[]>`
    SELECT l.id FROM "Lead" l
    WHERE l.status = 'OPEN'
      AND GREATEST(
        l."createdAt",
        (SELECT max(m."createdAt") FROM "Message" m WHERE m."leadId" = l.id),
        (SELECT max(e."createdAt") FROM "LeadEvent" e WHERE e."leadId" = l.id)
      ) < ${cutoff}
      AND COALESCE(
        (SELECT m.author::text FROM "Message" m WHERE m."leadId" = l.id ORDER BY m."createdAt" DESC LIMIT 1),
        ''
      ) <> 'CONTACT'`;

  const inLostStage = settings.lostStageIds.length
    ? await db.lead.findMany({
        where: { status: "OPEN", stageId: { in: settings.lostStageIds } },
        select: {
          id: true,
          events: {
            where: { type: "STAGE_CHANGED", reason: { not: null } },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { reason: true },
          },
        },
      })
    : [];

  const reasons = new Map<string, string>();
  for (const { id } of inactive) reasons.set(id, settings.reason);
  for (const lead of inLostStage) reasons.set(lead.id, lead.events[0]?.reason || settings.reason);

  let closed = 0;
  for (const [leadId, reason] of reasons) {
    // Alguien pudo cerrarlo a mano mientras corría la pasada.
    const lead = await db.lead.findUnique({ where: { id: leadId }, select: { status: true } });
    if (lead?.status !== "OPEN") continue;
    await closeLead(leadId, "LOST", { actor: "SYSTEM" }, { lostReason: reason });
    closed++;
  }
  await setSetting<AutoCloseRun>("autoCloseRun", { at: now.toISOString(), closed });
  return closed;
}
