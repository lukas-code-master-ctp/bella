import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { db } from "../db";
import { startOfLocalDay } from "../dates";
import { campaignOf } from "../domain/attribution";
import { getMetrics } from "../domain/metrics";
import { pushToUsers } from "../push";
import { getAssistantSettings } from "../settings";
import { getAiConfig } from "./config";
import { openRouterClient, type ProviderClients } from "./providers";

/**
 * Insights semanales: cada lunes la IA lee las conversaciones de la semana y arma un resumen
 * ejecutivo para la gerencia (qué piden los clientes, dónde se traba el embudo, fortalezas y
 * oportunidades). Se guarda en WeeklyInsight, se ve en Métricas → Resumen semanal y se avisa a
 * los admins con un "nuevo" en el menú y un push.
 *
 * Para no gastar de más, a la IA le llega por lead el resumen de una línea, el puntaje y una
 * muestra de lo que escribió el cliente en la semana, no la conversación completa.
 */

const MAX_LEADS = 60;
const MAX_CLIENT_MESSAGES = 6;
const MAX_CHARS_PER_MESSAGE = 280;

const List = z.array(z.string()).default([]);
const Report = z.object({
  resumen: z.string().min(1),
  loQuePiden: List,
  problemasEmbudo: List,
  fortalezas: List,
  oportunidades: List,
  recomendaciones: List,
});

export type WeeklyReport = {
  summary: string;
  asks: string[];
  funnelIssues: string[];
  strengths: string[];
  opportunities: string[];
  recommendations: string[];
};

export type WeeklyStats = { leads: number; open: number; won: number; lost: number; amount: number; activeLeads: number };

export const REPORT_SECTIONS: { key: Exclude<keyof WeeklyReport, "summary">; title: string }[] = [
  { key: "asks", title: "Qué piden los clientes" },
  { key: "funnelIssues", title: "Dónde se traba el embudo" },
  { key: "strengths", title: "Fortalezas" },
  { key: "opportunities", title: "Oportunidades" },
  { key: "recommendations", title: "Recomendaciones para esta semana" },
];

function reportPrompt(companyName: string) {
  return [
    `Eres analista comercial de ${companyName}. Recibes la actividad de la última semana del equipo de ventas ` +
      "(asistente IA y ejecutivos) con sus leads y escribes un resumen ejecutivo para la gerencia. " +
      "Respondes solo con un objeto JSON, sin texto adicional:",
    '{"resumen": string, "loQuePiden": string[], "problemasEmbudo": string[], "fortalezas": string[], ' +
      '"oportunidades": string[], "recomendaciones": string[]}',
    "",
    "- Todo en español de Chile, concreto y breve. Cada punto de las listas es una frase (máximo 200 caracteres).",
    "- resumen: 2 a 3 frases con lo más importante de la semana.",
    "- loQuePiden: lo que más preguntan o piden los clientes (productos, precios, formas de pago, dudas), " +
      "de lo más a lo menos frecuente.",
    "- problemasEmbudo: dónde se quedan los leads o por qué se pierden (sin respuesta, objeciones, demoras).",
    "- fortalezas: qué está funcionando (campañas, productos o respuestas que generan avance).",
    "- oportunidades: qué se podría aprovechar mejor.",
    "- recomendaciones: 2 a 4 acciones concretas para el equipo esta semana.",
    "- De 2 a 5 puntos por lista. Basa todo en los datos; si no hay evidencia para una lista, déjala vacía. " +
      "Cita números cuando los tengas (ej. \"6 de 20 leads preguntaron por financiamiento\").",
    "- No incluyas nombres, teléfonos ni datos personales de los clientes.",
  ].join("\n");
}

export function parseReport(text: string): WeeklyReport | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    const parsed = Report.safeParse(JSON.parse(text.slice(start, end + 1)));
    if (!parsed.success) return null;
    const clean = (items: string[]) =>
      items.map((s) => s.replace(/\s+/g, " ").trim().slice(0, 300)).filter(Boolean).slice(0, 6);
    const d = parsed.data;
    return {
      summary: d.resumen.trim().slice(0, 800),
      asks: clean(d.loQuePiden),
      funnelIssues: clean(d.problemasEmbudo),
      strengths: clean(d.fortalezas),
      opportunities: clean(d.oportunidades),
      recommendations: clean(d.recomendaciones),
    };
  } catch {
    return null;
  }
}

/** Arma lo que lee la IA: números de la semana y una muestra de cada lead con actividad. */
async function buildInput(from: Date, to: Date) {
  const metrics = await getMetrics({ from, to });
  const leads = await db.lead.findMany({
    where: {
      contact: { channel: { not: "SIMULATOR" } },
      messages: { some: { createdAt: { gte: from, lt: to } } },
    },
    orderBy: { updatedAt: "desc" },
    take: MAX_LEADS,
    include: {
      stage: true,
      source: true,
      contact: { include: { tags: { include: { tag: true } } } },
      messages: {
        where: { createdAt: { gte: from, lt: to }, author: "CONTACT" },
        orderBy: { createdAt: "asc" },
        take: MAX_CLIENT_MESSAGES,
      },
    },
  });
  const t = metrics.totals;
  const stats: WeeklyStats = { ...t, activeLeads: leads.length };
  const lines = [
    "<numeros_de_la_semana>",
    `Leads nuevos: ${t.leads} (abiertos ${t.open}, ganados ${t.won}, perdidos ${t.lost}). Ventas: $${t.amount.toLocaleString("es-CL")}.`,
    `Leads con conversación esta semana: ${leads.length}.`,
    `Embudo de los leads nuevos (llegaron a la etapa / están ahí): ${metrics.funnel.map((f) => `${f.name} ${f.reached}/${f.current}`).join(", ")}.`,
    `Por campaña u origen: ${metrics.byCampaign.map((r) => `${r.label} ${r.leads} leads, ${r.won} ganados`).join("; ") || "sin datos"}.`,
    `Motivos de pérdida: ${metrics.lostReasons.map((r) => `${r.reason} (${r.count})`).join("; ") || "ninguno"}.`,
    "</numeros_de_la_semana>",
    "",
    "<leads>",
  ];
  for (const [i, l] of leads.entries()) {
    const tags = l.contact.tags.map((ct) => `${ct.tag.category}: ${ct.tag.name}`).join(", ");
    const said = l.messages
      .map((m) => (m.mediaUrl ? (m.transcript ?? "") : m.body).replace(/\s+/g, " ").trim().slice(0, MAX_CHARS_PER_MESSAGE))
      .filter(Boolean)
      .map((s) => `  - "${s}"`);
    lines.push(
      `Lead ${i + 1}: etapa ${l.stage.name}; estado ${l.status}${l.lostReason ? ` (${l.lostReason})` : ""}; ` +
        `origen ${campaignOf(l.source) ?? (l.source ? l.source.kind : "directo")}` +
        (tags ? `; etiquetas ${tags}` : "") +
        (l.score !== null ? `; puntaje ${l.score}` : "") +
        (l.aiSummary ? `\n  Resumen: ${l.aiSummary}` : ""),
      ...(said.length ? ["  El cliente escribió:", ...said] : []),
    );
  }
  lines.push("</leads>");
  return { input: lines.join("\n"), stats };
}

let anthropicDefault: Anthropic | null = null;

/**
 * Genera el resumen de la semana [from, to) y lo guarda (reemplaza el de ese mismo período si ya
 * existía). Avisa a los admins con un push. Lanza si la IA falla, para que el cron lo registre.
 */
export async function generateWeeklyInsight(
  { from, to, clients = {} }: { from: Date; to: Date; clients?: ProviderClients },
) {
  const [{ input, stats }, settings, config] = await Promise.all([buildInput(from, to), getAssistantSettings(), getAiConfig()]);
  const system = reportPrompt(settings.companyName);

  let text: string;
  if (config.provider === "anthropic") {
    const api = clients.anthropic ?? (anthropicDefault ??= new Anthropic());
    const response = await api.beta.messages.create({
      model: config.model,
      max_tokens: 3000,
      system,
      messages: [{ role: "user", content: input }],
    });
    text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  } else {
    const response = await (clients.openrouter ?? openRouterClient).complete({
      model: config.model,
      max_tokens: 3000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: input },
      ],
    });
    text = response.choices?.[0]?.message.content ?? "";
  }
  const report = parseReport(text);
  if (!report) throw new Error(`El resumen semanal no vino en JSON válido: ${text.slice(0, 200)}`);

  const data = { periodStart: from, report, stats, model: config.model, seenBy: [] };
  const insight = await db.weeklyInsight.upsert({
    where: { periodEnd: to },
    create: { periodEnd: to, ...data },
    update: { ...data, createdAt: new Date() },
  });

  const admins = await db.user.findMany({ where: { role: "ADMIN", active: true }, select: { id: true } });
  await pushToUsers(
    admins.map((a) => a.id),
    { title: "Resumen semanal listo", body: report.summary.slice(0, 140), url: "/metrics/insights", tag: "weekly-insight" },
  );
  return insight;
}

/** Semana que cierra el cron: los 7 días completos (hora de Chile) que terminan hoy a las 00:00. */
export function lastWeekPeriod(now = new Date()) {
  return { from: startOfLocalDay(now, -7), to: startOfLocalDay(now) };
}

/** Para el cron del lunes: genera el de la semana pasada si aún no existe. */
export async function runWeeklyInsight(now = new Date(), clients: ProviderClients = {}) {
  const period = lastWeekPeriod(now);
  if (await db.weeklyInsight.findUnique({ where: { periodEnd: period.to } })) return { created: false };
  await generateWeeklyInsight({ ...period, clients });
  return { created: true };
}

/** Si hay un resumen que este admin no ha abierto (para el "nuevo" del menú). */
export async function hasUnseenInsight(userId: string) {
  const latest = await db.weeklyInsight.findFirst({ orderBy: { createdAt: "desc" }, select: { seenBy: true } });
  return !!latest && !latest.seenBy.includes(userId);
}
