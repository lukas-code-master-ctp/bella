import type { Prisma } from "@prisma/client";
import { db } from "../db";

/**
 * Métricas de llamadas de WhatsApp (Métricas → Llamadas): cuántas entran y se atienden, cuántas
 * se pierden, cuánto duran, quién llama y las perdidas recientes que nadie ha devuelto.
 */

export type CallFilter = { from: Date; to: Date; /** Un ejecutivo ve solo lo suyo. */ userId?: string };

export type UserCalls = {
  userId: string;
  name: string;
  answered: number;
  made: number;
  connected: number;
  totalSec: number;
};

export type MissedCall = { id: string; leadId: string; name: string; at: Date; calledBack: boolean };

export type CallReport = {
  inbound: number;
  inboundAnswered: number;
  inboundMissed: number;
  outbound: number;
  outboundConnected: number;
  outboundUnanswered: number;
  /** Promedio de las llamadas conectadas que tienen duración. */
  avgSec: number | null;
  totalSec: number;
  recorded: number;
  byUser: UserCalls[];
  recentMissed: MissedCall[];
};

const CONNECTED = ["ANSWERED", "ENDED"];
/** Aún sonando: no cuenta ni como atendida ni como perdida. */
const IN_PROGRESS = ["RINGING"];
const RECENT_MISSED = 10;

export async function getCallReport(f: CallFilter): Promise<CallReport> {
  const where: Prisma.CallWhereInput = {
    createdAt: { gte: f.from, lte: f.to },
    lead: { contact: { channel: { not: "SIMULATOR" } } },
    ...(f.userId ? { OR: [{ answeredById: f.userId }, { lead: { assigneeId: f.userId } }] } : {}),
  };
  const calls = await db.call.findMany({
    where,
    select: {
      id: true,
      leadId: true,
      direction: true,
      status: true,
      durationSec: true,
      recordingUrl: true,
      createdAt: true,
      answeredById: true,
      answeredBy: { select: { name: true } },
      lead: { select: { contact: { select: { name: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  const r: CallReport = {
    inbound: 0,
    inboundAnswered: 0,
    inboundMissed: 0,
    outbound: 0,
    outboundConnected: 0,
    outboundUnanswered: 0,
    avgSec: null,
    totalSec: 0,
    recorded: 0,
    byUser: [],
    recentMissed: [],
  };
  const users = new Map<string, UserCalls>();
  const user = (id: string, name: string) => {
    let u = users.get(id);
    if (!u) users.set(id, (u = { userId: id, name, answered: 0, made: 0, connected: 0, totalSec: 0 }));
    return u;
  };
  let timed = 0;
  const missed: typeof calls = [];
  for (const c of calls) {
    const connected = CONNECTED.includes(c.status);
    const seconds = connected ? (c.durationSec ?? 0) : 0;
    if (c.recordingUrl) r.recorded++;
    if (connected && c.durationSec != null) {
      r.totalSec += c.durationSec;
      timed++;
    }
    const u = c.answeredById && c.answeredBy ? user(c.answeredById, c.answeredBy.name) : null;
    if (c.direction === "OUTBOUND") {
      r.outbound++;
      if (u) u.made++;
      if (connected) {
        r.outboundConnected++;
        if (u) {
          u.connected++;
          u.totalSec += seconds;
        }
      } else if (!IN_PROGRESS.includes(c.status)) r.outboundUnanswered++;
    } else {
      r.inbound++;
      if (connected) {
        r.inboundAnswered++;
        if (u) {
          u.answered++;
          u.totalSec += seconds;
        }
      } else if (!IN_PROGRESS.includes(c.status)) {
        r.inboundMissed++;
        missed.push(c);
      }
    }
  }
  r.avgSec = timed ? Math.round(r.totalSec / timed) : null;
  // Con ejecutivo filtrado, la tabla muestra solo a esa persona.
  r.byUser = [...users.values()].filter((u) => !f.userId || u.userId === f.userId).sort((a, b) => b.answered + b.made - (a.answered + a.made));

  // Perdidas recientes: ¿alguien conectó con ese lead después (devolvió la llamada o el cliente volvió a llamar)?
  const recent = missed.slice(0, RECENT_MISSED);
  const later = recent.length
    ? await db.call.findMany({
        where: { leadId: { in: recent.map((c) => c.leadId) }, status: { in: CONNECTED } },
        select: { leadId: true, createdAt: true },
      })
    : [];
  r.recentMissed = recent.map((c) => ({
    id: c.id,
    leadId: c.leadId,
    name: c.lead.contact.name,
    at: c.createdAt,
    calledBack: later.some((l) => l.leadId === c.leadId && l.createdAt > c.createdAt),
  }));
  return r;
}

/** "1:07" o "1 h 05 min" para duraciones de llamadas. */
export function formatCallDuration(sec: number | null): string {
  if (sec == null) return "—";
  if (sec < 3600) return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  const h = Math.floor(sec / 3600);
  return `${h} h ${String(Math.round((sec % 3600) / 60)).padStart(2, "0")} min`;
}
