import type { WeeklyInsight } from "@prisma/client";
import { db } from "../db";
import { emailConfigured, escapeHtml, parseEmails, resendSender, type EmailSender } from "../email";
import { getAssistantSettings, getSetting, setSetting } from "../settings";
import { REPORT_SECTIONS, type WeeklyReport, type WeeklyStats } from "../ai/weekly-insights";

/**
 * Envío del resumen semanal por correo. Viene apagado: se enciende en Métricas → Resumen semanal
 * con el remitente (de un dominio verificado en Resend) y a quién mandarlo.
 */
export type WeeklyEmailSettings = {
  enabled: boolean;
  /** Ej. "Bella <reportes@miempresa.cl>". */
  from: string;
  /** Mandarlo a todos los admins activos. */
  toAdmins: boolean;
  /** Otras direcciones (gerencia), separadas por comas. */
  extra: string;
};

export const DEFAULT_WEEKLY_EMAIL: WeeklyEmailSettings = { enabled: false, from: "", toAdmins: true, extra: "" };

/** Resultado del último envío, para mostrarlo en la página. */
export type WeeklyEmailLog = { at: string; ok: boolean; detail: string };

const APP_URL =
  process.env.APP_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");

export async function getWeeklyEmailSettings(): Promise<WeeklyEmailSettings> {
  return { ...DEFAULT_WEEKLY_EMAIL, ...(await getSetting<Partial<WeeklyEmailSettings>>("weeklyEmail", {})) };
}

export async function saveWeeklyEmailSettings(s: WeeklyEmailSettings) {
  await setSetting("weeklyEmail", { ...s, extra: parseEmails(s.extra).join(", ") });
}

export async function getWeeklyEmailLog() {
  return getSetting<WeeklyEmailLog | null>("weeklyEmailLog", null);
}

export async function weeklyEmailRecipients(s: WeeklyEmailSettings): Promise<string[]> {
  const admins = s.toAdmins
    ? (await db.user.findMany({ where: { role: "ADMIN", active: true }, select: { email: true } })).map((u) => u.email)
    : [];
  return parseEmails([...admins, s.extra].join(","));
}

const day = (d: Date) => d.toLocaleDateString("es-CL", { day: "numeric", month: "long", timeZone: "America/Santiago" });
const int = (n: number) => n.toLocaleString("es-CL");

/** Asunto, HTML y texto plano del correo de un resumen. */
export function renderWeeklyEmail(insight: Pick<WeeklyInsight, "id" | "periodStart" | "periodEnd" | "report" | "stats">, companyName: string) {
  const report = insight.report as WeeklyReport;
  const stats = insight.stats as WeeklyStats;
  // El período termina a las 00:00 del día siguiente al último incluido.
  const period = `${day(insight.periodStart)} al ${day(new Date(insight.periodEnd.getTime() - 1))}`;
  const subject = `Resumen semanal de ${companyName}: ${period}`;
  const numbers = `${int(stats.leads)} leads nuevos · ${int(stats.activeLeads)} con conversación · ${int(stats.won)} ganados · ${int(stats.lost)} perdidos`;
  const link = APP_URL ? `${APP_URL}/metrics/insights?id=${insight.id}` : null;
  const sections = REPORT_SECTIONS.filter((s) => report[s.key]?.length);

  const text = [
    `Semana del ${period}`,
    numbers,
    "",
    report.summary,
    ...sections.flatMap((s) => ["", s.title, ...report[s.key].map((i) => `- ${i}`)]),
    ...(link ? ["", `Ver en Bella: ${link}`] : []),
  ].join("\n");

  const html = [
    `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1c1530;line-height:1.5">`,
    `<p style="color:#7c3aed;font-weight:bold;margin:0">Resumen semanal</p>`,
    `<h1 style="font-size:20px;margin:4px 0">Semana del ${escapeHtml(period)}</h1>`,
    `<p style="color:#6b6380;font-size:14px;margin:0 0 16px">${escapeHtml(numbers)}</p>`,
    `<p style="font-size:15px">${escapeHtml(report.summary)}</p>`,
    ...sections.map(
      (s) =>
        `<h2 style="font-size:16px;margin:20px 0 6px">${escapeHtml(s.title)}</h2><ul style="padding-left:20px;margin:0">` +
        report[s.key].map((i) => `<li style="margin-bottom:4px">${escapeHtml(i)}</li>`).join("") +
        "</ul>",
    ),
    link
      ? `<p style="margin-top:24px"><a href="${escapeHtml(link)}" style="background:#7c3aed;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Ver en Bella</a></p>`
      : "",
    `<p style="color:#6b6380;font-size:12px;margin-top:24px">Generado por la IA. Revisa los datos antes de tomar decisiones importantes.</p>`,
    `</div>`,
  ].join("");
  return { subject, html, text };
}

/**
 * Manda por correo un resumen semanal. Con `force` se manda aunque el envío automático esté
 * apagado (botón "Enviar ahora"). Devuelve el resultado, que también queda anotado.
 */
export async function sendWeeklyInsightEmail(
  insightId: string,
  { force = false, sender = resendSender }: { force?: boolean; sender?: EmailSender } = {},
): Promise<WeeklyEmailLog | null> {
  const s = await getWeeklyEmailSettings();
  if (!s.enabled && !force) return null;
  const log = async (ok: boolean, detail: string) => {
    const entry = { at: new Date().toISOString(), ok, detail };
    await setSetting("weeklyEmailLog", entry);
    return entry;
  };
  if (sender === resendSender && !emailConfigured()) return log(false, "Falta RESEND_API_KEY en las variables de entorno.");
  if (!s.from.includes("@")) return log(false, "Falta el remitente.");
  const to = await weeklyEmailRecipients(s);
  if (!to.length) return log(false, "No hay destinatarios.");
  const insight = await db.weeklyInsight.findUniqueOrThrow({ where: { id: insightId } });
  const { companyName } = await getAssistantSettings();
  try {
    await sender.send({ from: s.from, to, ...renderWeeklyEmail(insight, companyName) });
  } catch (err) {
    return log(false, err instanceof Error ? err.message : String(err));
  }
  return log(true, `Enviado a ${to.length} ${to.length === 1 ? "destinatario" : "destinatarios"}.`);
}
