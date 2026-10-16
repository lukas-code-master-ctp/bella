import { Prisma, type CampaignAlert } from "@prisma/client";
import { db } from "../db";
import { getSetting, setSetting } from "../settings";
import { pushToUsers } from "../push";
import { emailUsers } from "./email-notifications";
import { pauseMetaCampaign } from "../channels/ads";
import { generateCampaignAdvice } from "../ai/campaign-advice";
import type { ProviderClients } from "../ai/providers";
import { campaignOf } from "./attribution";

/**
 * Alertas de campañas que traen leads que se pierden casi todos: se revisan los leads que llegaron
 * en los últimos días por cada campaña (de Meta o utm_campaign) y, si son suficientes y la mayoría
 * terminó perdida, se abre una alerta, la IA lee las conversaciones perdidas y recomienda cómo
 * mejorar la campaña (o apagarla), y se avisa a los admins. Pausar la campaña en Meta es opcional,
 * viene apagado y siempre lo confirma un admin con un botón.
 */

export type CampaignAlertSettings = {
  /** Revisar las campañas y avisar a los admins (solo avisa al equipo, nunca a los leads). */
  enabled: boolean;
  /** Mínimo de leads de la campaña en la ventana para juzgarla. */
  minLeads: number;
  /** Porcentaje de perdidos (sobre todos sus leads de la ventana) desde el que se alerta. */
  lostPct: number;
  /** Días hacia atrás que se revisan. */
  days: number;
  /** Mostrar el botón para pausar la campaña en Meta (necesita ads_management). */
  allowPause: boolean;
};

export const DEFAULT_CAMPAIGN_ALERTS: CampaignAlertSettings = { enabled: true, minLeads: 10, lostPct: 70, days: 14, allowPause: false };

const clampInt = (n: unknown, min: number, max: number, fallback: number) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
};

export async function getCampaignAlertSettings(): Promise<CampaignAlertSettings> {
  return { ...DEFAULT_CAMPAIGN_ALERTS, ...(await getSetting<Partial<CampaignAlertSettings>>("campaignAlerts", {})) };
}

export async function saveCampaignAlertSettings(s: Partial<CampaignAlertSettings>) {
  const d = DEFAULT_CAMPAIGN_ALERTS;
  const next = { ...(await getCampaignAlertSettings()), ...s };
  await setSetting<CampaignAlertSettings>("campaignAlerts", {
    enabled: Boolean(next.enabled),
    minLeads: clampInt(next.minLeads, 3, 1000, d.minLeads),
    lostPct: clampInt(next.lostPct, 30, 100, d.lostPct),
    days: clampInt(next.days, 3, 90, d.days),
    allowPause: Boolean(next.allowPause),
  });
}

export type Reason = { reason: string; count: number };
export type CampaignStat = {
  campaign: string;
  campaignId: string | null;
  leads: number;
  lost: number;
  won: number;
  reasons: Reason[];
  /** Ids de sus leads perdidos, del más reciente al más antiguo. */
  lostLeadIds: string[];
};

/** Números de cada campaña con los leads que llegaron desde `from` (sin el simulador). */
export async function campaignStats(from: Date): Promise<CampaignStat[]> {
  const leads = await db.lead.findMany({
    where: { createdAt: { gte: from }, contact: { channel: { not: "SIMULATOR" } }, source: { isNot: null } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      lostReason: true,
      source: { select: { campaignId: true, campaignName: true, utmCampaign: true, adHeadline: true, adId: true } },
    },
  });
  const byCampaign = new Map<string, CampaignStat & { reasonMap: Map<string, number> }>();
  for (const l of leads) {
    const campaign = campaignOf(l.source);
    if (!campaign) continue;
    const s = byCampaign.get(campaign) ?? {
      campaign,
      campaignId: null,
      leads: 0,
      lost: 0,
      won: 0,
      reasons: [],
      lostLeadIds: [],
      reasonMap: new Map<string, number>(),
    };
    s.leads++;
    s.campaignId ??= l.source?.campaignId ?? null;
    if (l.status === "WON") s.won++;
    if (l.status === "LOST") {
      s.lost++;
      s.lostLeadIds.push(l.id);
      const r = l.lostReason?.trim() || "Sin motivo";
      s.reasonMap.set(r, (s.reasonMap.get(r) ?? 0) + 1);
    }
    byCampaign.set(campaign, s);
  }
  return [...byCampaign.values()].map(({ reasonMap, ...s }) => ({
    ...s,
    reasons: [...reasonMap.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 6),
  }));
}

export const isLosing = (s: Pick<CampaignStat, "leads" | "lost">, cfg: Pick<CampaignAlertSettings, "minLeads" | "lostPct">) =>
  s.leads >= cfg.minLeads && s.lost * 100 >= cfg.lostPct * s.leads;

export const windowStart = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000);

/**
 * Revisa las campañas: abre (o reabre) una alerta por cada campaña que cruza el umbral, le pide a
 * la IA la recomendación y avisa a los admins; actualiza los números de las que siguen en alerta y
 * cierra las que volvieron a quedar bajo el umbral. Si la IA falla, la alerta queda igual y la
 * recomendación se puede pedir de nuevo desde Métricas.
 */
export async function runCampaignAlerts(now = new Date(), clients: ProviderClients = {}) {
  const cfg = await getCampaignAlertSettings();
  if (!cfg.enabled) return { enabled: false, opened: 0, resolved: 0 };
  const stats = await campaignStats(windowStart(now, cfg.days));
  const losing = stats.filter((s) => isLosing(s, cfg));
  const active = await db.campaignAlert.findMany({ where: { resolvedAt: null } });
  const activeNames = new Set(active.map((a) => a.campaign));

  const opened: { alert: CampaignAlert; stat: CampaignStat }[] = [];
  for (const s of losing) {
    const numbers = { campaignId: s.campaignId, leads: s.leads, lost: s.lost, won: s.won, reasons: s.reasons };
    if (activeNames.has(s.campaign)) {
      await db.campaignAlert.updateMany({ where: { campaign: s.campaign, resolvedAt: null }, data: numbers });
      continue;
    }
    // Nueva, o una que se había resuelto y volvió a empeorar: parte de cero.
    const fresh = { ...numbers, detectedAt: now, resolvedAt: null, advice: Prisma.DbNull, adviceModel: null, adviceAt: null, pausedAt: null, pausedById: null };
    const existing = await db.campaignAlert.findFirst({ where: { campaign: s.campaign }, select: { id: true } });
    const alert = existing
      ? await db.campaignAlert.update({ where: { id: existing.id }, data: fresh })
      : await db.campaignAlert.create({ data: { campaign: s.campaign, ...fresh } });
    opened.push({ alert, stat: s });
  }

  const losingNames = new Set(losing.map((s) => s.campaign));
  const toResolve = active.filter((a) => !losingNames.has(a.campaign)).map((a) => a.id);
  if (toResolve.length) await db.campaignAlert.updateMany({ where: { id: { in: toResolve } }, data: { resolvedAt: now } });

  if (opened.length) {
    for (const o of opened) {
      try {
        await generateCampaignAdvice({ alert: o.alert, lostLeadIds: o.stat.lostLeadIds, days: cfg.days, clients });
      } catch (e) {
        console.error(`[alertas de campaña] recomendación de ${o.stat.campaign}:`, e);
      }
    }
    const admins = await db.user.findMany({ where: { role: "ADMIN", active: true }, select: { id: true } });
    const first = opened[0].stat;
    const notice = {
      title: opened.length > 1 ? `${opened.length} campañas pierden casi todos sus leads` : "Campaña con muchos leads perdidos",
      body: `${first.campaign}: ${first.lost} de ${first.leads} leads perdidos en ${cfg.days} días. Revisa las recomendaciones.`,
      url: "/metrics/campaigns",
    };
    const adminIds = admins.map((a) => a.id);
    await pushToUsers(adminIds, { ...notice, tag: "campaign-alert" });
    await emailUsers(adminIds, "CAMPAIGN_ALERT", notice);
  }
  return { enabled: true, opened: opened.length, resolved: toResolve.length };
}

/** Vuelve a pedir la recomendación de la IA con los leads perdidos de hoy. Lanza si la IA falla. */
export async function refreshCampaignAdvice(alertId: string, now = new Date(), clients: ProviderClients = {}) {
  const cfg = await getCampaignAlertSettings();
  const alert = await db.campaignAlert.findUniqueOrThrow({ where: { id: alertId } });
  const stat = (await campaignStats(windowStart(now, cfg.days))).find((s) => s.campaign === alert.campaign);
  return generateCampaignAdvice({ alert, lostLeadIds: stat?.lostLeadIds ?? [], days: cfg.days, clients });
}

/** Alertas abiertas, de la más reciente a la más antigua. */
export function activeCampaignAlerts() {
  return db.campaignAlert.findMany({ where: { resolvedAt: null }, orderBy: [{ detectedAt: "desc" }, { campaign: "asc" }] });
}

export const countActiveCampaignAlerts = () => db.campaignAlert.count({ where: { resolvedAt: null } });

/**
 * Pausa en Meta la campaña de la alerta. Solo si el admin encendió el botón en la configuración y
 * la campaña tiene id de Meta. Devuelve null si quedó pausada o el motivo si no.
 */
export async function pauseAlertCampaign(alertId: string, userId: string, pause = pauseMetaCampaign): Promise<string | null> {
  const cfg = await getCampaignAlertSettings();
  if (!cfg.allowPause) return "Pausar campañas desde Beliapp está apagado en la configuración de alertas.";
  const alert = await db.campaignAlert.findUnique({ where: { id: alertId } });
  if (!alert) return "La alerta ya no existe.";
  if (alert.pausedAt) return null;
  if (!alert.campaignId) return "Esta campaña no tiene id de Meta (viene de un enlace con UTM o falta el token de anuncios): páusala desde el Administrador de anuncios.";
  const error = await pause(alert.campaignId);
  if (error) return error;
  await db.campaignAlert.update({ where: { id: alertId }, data: { pausedAt: new Date(), pausedById: userId } });
  return null;
}
