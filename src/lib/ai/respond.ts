import { db } from "../db";
import { runAgent } from "./agent";
import { refreshLeadInsights } from "./insights";
import type { ProviderClients } from "./providers";

/** Lo que dura como máximo un turno de la IA antes de que otro servidor pueda tomar el lead. */
const BUSY_MS = 3 * 60 * 1000;

async function hasUnanswered(leadId: string) {
  const [last, transcript] = await Promise.all([
    db.message.findFirst({ where: { leadId, author: "CONTACT" }, orderBy: { createdAt: "desc" } }),
    db.agentTranscript.findUnique({ where: { leadId } }),
  ]);
  return Boolean(last && (!transcript || last.createdAt > transcript.syncedUntil));
}

/**
 * La IA responde a un lead de un canal real. Cada webhook corre en su propio servidor, así que
 * el lead se "toma" en la base para que dos mensajes seguidos del cliente no reciban dos
 * respuestas a la vez: quien lo tiene responde todo lo pendiente antes de soltarlo, y quien no
 * lo pudo tomar no hace nada (lo suyo lo responde el otro).
 */
export async function answerLead(leadId: string, clients: ProviderClients = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const now = new Date();
    const claimed = await db.lead.updateMany({
      where: { id: leadId, OR: [{ agentBusyUntil: null }, { agentBusyUntil: { lt: now } }] },
      data: { agentBusyUntil: new Date(now.getTime() + BUSY_MS) },
    });
    if (!claimed.count) return;
    try {
      // runAgent responde todo lo pendiente; si llegó algo más mientras pensaba, otra vuelta.
      for (let turn = 0; turn < 3; turn++) {
        if ((await runAgent(leadId, clients)) === "skipped") break;
      }
    } catch (err) {
      console.error(`[respond] lead ${leadId}:`, err);
    } finally {
      await db.lead.update({ where: { id: leadId }, data: { agentBusyUntil: null } });
    }
    // Un mensaje que llegó justo al soltar el lead quedaría sin respuesta: se revisa una vez más.
    if (!(await hasUnanswered(leadId))) break;
  }
  await refreshLeadInsights(leadId, { clients }).catch((err) => console.error(`[respond] resumen del lead ${leadId}:`, err));
}
