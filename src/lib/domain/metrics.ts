import type { Channel } from "@prisma/client";
import { db } from "../db";
import type { CampaignSpend } from "../channels/ads";
import { campaignOf, originOf, type LeadOrigin } from "./attribution";

/**
 * Panel de métricas. Todo se calcula sobre los leads que entraron en el período (una cohorte):
 * cuántos llegaron, por dónde, hasta qué etapa avanzaron, qué tan rápido se les respondió y
 * cómo terminaron. Los leads del simulador no cuentan.
 */

/**
 * Con `funnelId`, solo los leads de ese embudo (y el gráfico de embudo con sus etapas); con
 * `channel` u `origin`, solo los que llegaron por ese canal o desde ese origen (ver originOf).
 */
export type MetricsFilter = {
  from: Date;
  to: Date;
  assigneeId?: string;
  funnelId?: string;
  channel?: Exclude<Channel, "SIMULATOR">;
  origin?: LeadOrigin;
};

export type Row = { key: string; label: string; leads: number; won: number; lost: number; amount: number };
export type ExecRow = Row & { firstReplyMs: number | null };
export type FunnelStep = { stageId: string; name: string; reached: number; current: number };
export type ResponseStats = { count: number; medianMs: number | null; p90Ms: number | null; within5m: number };

export type Metrics = {
  totals: { leads: number; open: number; won: number; lost: number; amount: number };
  byChannel: Row[];
  byCampaign: Row[];
  /** Por campaña (misma clave que byCampaign): cuántos de sus leads llegaron a cada etapa del embudo. */
  campaignReach: Record<string, number[]>;
  funnel: FunnelStep[];
  firstReply: ResponseStats;
  firstHumanReply: ResponseStats;
  byExecutive: ExecRow[];
  lostReasons: { reason: string; count: number }[];
};

const CHANNEL_ORDER: Channel[] = ["WHATSAPP", "INSTAGRAM", "FACEBOOK", "WEB"];

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

function responseStats(times: number[]): ResponseStats {
  const sorted = [...times].sort((a, b) => a - b);
  return {
    count: sorted.length,
    medianMs: percentile(sorted, 0.5),
    p90Ms: percentile(sorted, 0.9),
    within5m: sorted.filter((t) => t <= 5 * 60_000).length,
  };
}

type Tally = { label: string; leads: number; won: number; lost: number; amount: number };

function tally(map: Map<string, Tally>, key: string, label: string, lead: { status: string; amount: number | null }) {
  const t = map.get(key) ?? { label, leads: 0, won: 0, lost: 0, amount: 0 };
  t.leads++;
  if (lead.status === "WON") {
    t.won++;
    t.amount += lead.amount ?? 0;
  }
  if (lead.status === "LOST") t.lost++;
  map.set(key, t);
}

const rows = (map: Map<string, Tally>): Row[] =>
  [...map.entries()].map(([key, t]) => ({ key, ...t })).sort((a, b) => b.leads - a.leads || a.label.localeCompare(b.label));

export async function getMetrics(filter: MetricsFilter): Promise<Metrics> {
  const where = {
    createdAt: { gte: filter.from, lt: filter.to },
    contact: { channel: filter.channel ?? { not: "SIMULATOR" as const } },
    ...(filter.assigneeId ? { assigneeId: filter.assigneeId } : {}),
    ...(filter.funnelId ? { stage: { funnelId: filter.funnelId } } : {}),
  };
  const [all, stages] = await Promise.all([
    db.lead.findMany({
      where,
      select: {
        id: true,
        status: true,
        amount: true,
        lostReason: true,
        stageId: true,
        assigneeId: true,
        assignee: { select: { name: true } },
        contact: { select: { channel: true } },
        source: {
          select: { kind: true, campaignName: true, utmCampaign: true, adHeadline: true, adId: true, utmSource: true, utmMedium: true, gclid: true },
        },
        events: { where: { type: { in: ["CREATED", "STAGE_CHANGED"] } }, select: { data: true } },
      },
    }),
    db.stage.findMany({ where: filter.funnelId ? { funnelId: filter.funnelId } : {}, orderBy: { position: "asc" } }),
  ]);
  const leads = filter.origin ? all.filter((l) => originOf(l.source) === filter.origin) : all;
  const ids = leads.map((l) => l.id);
  // Por lead, solo las tres fechas que importan: el primer mensaje del cliente y la primera
  // respuesta (de cualquiera y del equipo) desde ahí.
  const replyRows = ids.length
    ? await db.$queryRaw<{ leadId: string; contactAt: Date; replyAt: Date | null; humanAt: Date | null }[]>`
        WITH first AS (
          SELECT "leadId", MIN("createdAt") AS at FROM "Message"
          WHERE "leadId" = ANY(${ids}) AND "author" = 'CONTACT' GROUP BY "leadId"
        )
        SELECT f."leadId", f.at AS "contactAt",
          MIN(m."createdAt") FILTER (WHERE m."author" <> 'CONTACT') AS "replyAt",
          MIN(m."createdAt") FILTER (WHERE m."author" = 'USER') AS "humanAt"
        FROM first f JOIN "Message" m ON m."leadId" = f."leadId" AND m."createdAt" >= f.at
        GROUP BY f."leadId", f.at`
    : [];

  // Totales, canales, campañas, ejecutivos y motivos de pérdida.
  const totals = { leads: leads.length, open: 0, won: 0, lost: 0, amount: 0 };
  const channels = new Map<string, Tally>();
  const campaigns = new Map<string, Tally>();
  const execs = new Map<string, Tally>();
  const reasons = new Map<string, number>();
  const campaignKey = new Map<string, string>();
  for (const l of leads) {
    if (l.status === "OPEN") totals.open++;
    if (l.status === "WON") {
      totals.won++;
      totals.amount += l.amount ?? 0;
    }
    if (l.status === "LOST") {
      totals.lost++;
      const r = l.lostReason?.trim() || "Sin motivo";
      reasons.set(r, (reasons.get(r) ?? 0) + 1);
    }
    tally(channels, l.contact.channel, l.contact.channel, l);
    const campaign = campaignOf(l.source);
    const key = campaign ? `c:${campaign}` : l.source ? `s:${l.source.kind}` : "direct";
    campaignKey.set(l.id, key);
    tally(
      campaigns,
      key,
      campaign ?? (l.source?.kind === "AD" ? "Anuncio sin campaña" : l.source ? "Enlace sin campaña" : "Directo (sin anuncio ni UTM)"),
      l,
    );
    tally(execs, l.assigneeId ?? "none", l.assignee?.name ?? "Sin asignar", l);
  }
  const byChannel = rows(channels).sort(
    (a, b) => CHANNEL_ORDER.indexOf(a.key as Channel) - CHANNEL_ORDER.indexOf(b.key as Channel),
  );

  // Embudo: hasta qué etapa llegó cada lead (la más avanzada por la que pasó).
  const position = new Map(stages.map((s, i) => [s.name, i]));
  const positionById = new Map(stages.map((s, i) => [s.id, i]));
  const reachedCount = new Array(stages.length).fill(0) as number[];
  const currentCount = new Array(stages.length).fill(0) as number[];
  const campaignReach: Record<string, number[]> = {};
  for (const l of leads) {
    const at = positionById.get(l.stageId);
    if (at === undefined) continue;
    let max = at;
    currentCount[max]++;
    for (const e of l.events) {
      const d = e.data as { stage?: string; to?: string };
      const p = position.get(d.to ?? d.stage ?? "");
      if (p !== undefined && p > max) max = p;
    }
    const byKey = (campaignReach[campaignKey.get(l.id)!] ??= new Array(stages.length).fill(0) as number[]);
    for (let i = 0; i <= max; i++) {
      reachedCount[i]++;
      byKey[i]++;
    }
  }
  const funnel = stages.map((s, i) => ({ stageId: s.id, name: s.name, reached: reachedCount[i], current: currentCount[i] }));

  // Tiempo hasta la primera respuesta (de la IA o del equipo) y hasta la primera del equipo.
  const firstReply = new Map<string, number>();
  const firstHuman = new Map<string, number>();
  for (const r of replyRows) {
    if (r.replyAt) firstReply.set(r.leadId, r.replyAt.getTime() - r.contactAt.getTime());
    if (r.humanAt) firstHuman.set(r.leadId, r.humanAt.getTime() - r.contactAt.getTime());
  }
  const humanByExec = new Map<string, number[]>();
  for (const l of leads) {
    const t = firstHuman.get(l.id);
    if (t === undefined) continue;
    const key = l.assigneeId ?? "none";
    humanByExec.set(key, [...(humanByExec.get(key) ?? []), t]);
  }
  const byExecutive = rows(execs).map((r) => ({ ...r, firstReplyMs: responseStats(humanByExec.get(r.key) ?? []).medianMs }));

  return {
    totals,
    byChannel,
    byCampaign: rows(campaigns),
    campaignReach,
    funnel,
    firstReply: responseStats([...firstReply.values()]),
    firstHumanReply: responseStats([...firstHuman.values()]),
    byExecutive,
    lostReasons: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
  };
}

export type CampaignReturn = Row & { spend: number | null };
export type AdReturns = {
  rows: CampaignReturn[];
  /** Solo de las campañas con gasto: lo invertido y lo que trajeron. */
  spend: number;
  leads: number;
  won: number;
  amount: number;
};

/**
 * Cruza las filas "Por campaña" con el gasto de Meta (por nombre de campaña, que es el mismo que
 * se guardó en el origen del lead). Las campañas que gastaron sin traer leads también aparecen:
 * es justo lo que hay que ver. Las filas sin campaña de Meta (UTM, directo) quedan sin gasto.
 */
export function adReturns(byCampaign: Row[], spends: CampaignSpend[]): AdReturns {
  const spendByName = new Map<string, number>();
  for (const s of spends) spendByName.set(s.campaignName, (spendByName.get(s.campaignName) ?? 0) + s.spend);
  const rows: CampaignReturn[] = byCampaign.map((r) => ({
    ...r,
    spend: r.key.startsWith("c:") ? (spendByName.get(r.label) ?? null) : null,
  }));
  const seen = new Set(rows.map((r) => r.label));
  for (const [name, spend] of spendByName) {
    if (!seen.has(name) && spend > 0) rows.push({ key: `c:${name}`, label: name, leads: 0, won: 0, lost: 0, amount: 0, spend });
  }
  rows.sort((a, b) => (b.spend ?? -1) - (a.spend ?? -1) || b.leads - a.leads || a.label.localeCompare(b.label));
  const paid = rows.filter((r) => r.spend !== null);
  return {
    rows,
    spend: paid.reduce((n, r) => n + (r.spend ?? 0), 0),
    leads: paid.reduce((n, r) => n + r.leads, 0),
    won: paid.reduce((n, r) => n + r.won, 0),
    amount: paid.reduce((n, r) => n + r.amount, 0),
  };
}

/** Duración legible: "45 s", "12 min", "3 h 20 min", "2 d 4 h". */
export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}
