import { z } from "zod";
import type { CampaignAlert } from "@prisma/client";
import { db } from "../db";
import { getAssistantSettings } from "../settings";
import { completeOnce, jsonIn } from "./complete";
import type { ProviderClients } from "./providers";

/**
 * Recomendación de la IA para una campaña cuyos leads se pierden casi todos (ver
 * src/lib/domain/campaign-alerts.ts): lee el anuncio, los motivos de pérdida y lo que escribieron
 * los leads perdidos, y dice por qué se pierden, qué cambiar en la campaña y si conviene apagarla.
 */

const MAX_LEADS = 25;
const MAX_CLIENT_MESSAGES = 5;
const MAX_CHARS_PER_MESSAGE = 240;

const List = z.array(z.string()).default([]);
const Advice = z.object({
  diagnostico: z.string().min(1),
  causas: List,
  mejoras: List,
  apagar: z.boolean().default(false),
  motivoApagar: z.string().default(""),
});

export type CampaignAdvice = {
  diagnosis: string;
  causes: string[];
  improvements: string[];
  shouldPause: boolean;
  pauseReason: string;
};

function prompt(companyName: string) {
  return [
    `Eres especialista en campañas de Meta Ads de ${companyName}. Una campaña trae leads que la asistente IA y ` +
      "el equipo atienden por chat, y casi todos terminan perdidos. Recibes los números, el anuncio y lo que " +
      "escribieron los leads perdidos. Respondes solo con un objeto JSON, sin texto adicional:",
    '{"diagnostico": string, "causas": string[], "mejoras": string[], "apagar": boolean, "motivoApagar": string}',
    "",
    "- Todo en español de Chile, concreto y breve. Cada punto es una frase (máximo 220 caracteres).",
    "- diagnostico: 1 a 2 frases con por qué se pierden los leads de esta campaña.",
    "- causas: 2 a 4 causas con evidencia de los datos (ej. \"7 de 12 dijeron que el precio supera su presupuesto\"). " +
      "Distingue si el problema es el público (llegan personas que no pueden o no quieren comprar), el mensaje del " +
      "anuncio (promete algo distinto a la oferta) o la atención (demoras, respuestas que no resuelven).",
    "- mejoras: 2 a 5 cambios concretos a la campaña: público y segmentación, texto o creatividad del anuncio, " +
      "preguntas de filtro, oferta o destino. Si la causa es la atención y no la campaña, dilo.",
    "- apagar: true solo si la campaña no tiene arreglo razonable o atrae un público que no compra; en motivoApagar, " +
      "una frase con el porqué. Si no conviene apagarla, false y motivoApagar vacío.",
    "- Basa todo en los datos; no inventes cifras. No incluyas nombres, teléfonos ni datos personales.",
  ].join("\n");
}

export function parseAdvice(text: string): CampaignAdvice | null {
  const parsed = Advice.safeParse(jsonIn(text));
  if (!parsed.success) return null;
  const clean = (items: string[]) => items.map((s) => s.replace(/\s+/g, " ").trim().slice(0, 300)).filter(Boolean).slice(0, 6);
  const d = parsed.data;
  return {
    diagnosis: d.diagnostico.trim().slice(0, 600),
    causes: clean(d.causas),
    improvements: clean(d.mejoras),
    shouldPause: d.apagar,
    pauseReason: d.apagar ? d.motivoApagar.trim().slice(0, 300) : "",
  };
}

async function buildInput(alert: CampaignAlert, lostLeadIds: string[], days: number) {
  const leads = await db.lead.findMany({
    where: { id: { in: lostLeadIds.slice(0, MAX_LEADS) } },
    orderBy: { createdAt: "desc" },
    include: {
      stage: { select: { name: true } },
      source: true,
      messages: { where: { author: "CONTACT" }, orderBy: { createdAt: "asc" }, take: MAX_CLIENT_MESSAGES },
    },
  });
  const ads = new Map<string, string>();
  for (const l of leads) {
    const s = l.source;
    if (!s) continue;
    const key = s.adId ?? s.adName ?? s.adHeadline ?? s.utmContent ?? "";
    if (!key || ads.has(key) || ads.size >= 3) continue;
    const parts = [
      s.adName && `nombre "${s.adName}"`,
      s.adsetName && `conjunto "${s.adsetName}"`,
      s.adHeadline && `título "${s.adHeadline}"`,
      s.adBody && `texto "${s.adBody.replace(/\s+/g, " ").slice(0, 400)}"`,
      s.utmSource && `utm_source ${s.utmSource}`,
      s.utmContent && `utm_content ${s.utmContent}`,
      s.landingUrl && `landing ${s.landingUrl}`,
    ].filter(Boolean);
    if (parts.length) ads.set(key, parts.join("; "));
  }
  const reasons = (alert.reasons as { reason: string; count: number }[]) ?? [];
  const lines = [
    "<campana>",
    `Campaña: ${alert.campaign}.`,
    `Últimos ${days} días: ${alert.leads} leads, ${alert.lost} perdidos, ${alert.won} ganados, ${alert.leads - alert.lost - alert.won} abiertos.`,
    `Motivos de pérdida: ${reasons.map((r) => `${r.reason} (${r.count})`).join("; ") || "sin motivos registrados"}.`,
    ...(ads.size ? ["Anuncios:", ...[...ads.values()].map((a) => `- ${a}`)] : ["Sin datos del anuncio."]),
    "</campana>",
    "",
    "<leads_perdidos>",
  ];
  for (const [i, l] of leads.entries()) {
    const said = l.messages
      .map((m) => (m.transcript ?? m.body).replace(/\s+/g, " ").trim().slice(0, MAX_CHARS_PER_MESSAGE))
      .filter(Boolean)
      .map((s) => `  - "${s}"`);
    const hours = l.closedAt ? Math.round((l.closedAt.getTime() - l.createdAt.getTime()) / 3_600_000) : null;
    lines.push(
      `Lead ${i + 1}: perdido en la etapa ${l.stage.name}` +
        (l.lostReason ? ` (motivo: ${l.lostReason})` : "") +
        (hours !== null ? `, ${hours < 24 ? `${hours} h` : `${Math.round(hours / 24)} d`} después de llegar` : "") +
        (l.aiSummary ? `\n  Resumen: ${l.aiSummary}` : ""),
      ...(said.length ? ["  El cliente escribió:", ...said] : []),
    );
  }
  lines.push("</leads_perdidos>");
  return lines.join("\n");
}

/** Pide la recomendación y la guarda en la alerta. Lanza si la IA falla o no responde en JSON. */
export async function generateCampaignAdvice(
  { alert, lostLeadIds, days, clients = {} }: { alert: CampaignAlert; lostLeadIds: string[]; days: number; clients?: ProviderClients },
) {
  const [input, settings] = await Promise.all([buildInput(alert, lostLeadIds, days), getAssistantSettings()]);
  const { text, model } = await completeOnce({ system: prompt(settings.companyName), input, maxTokens: 2000, clients });
  const advice = parseAdvice(text);
  if (!advice) throw new Error(`La recomendación no vino en JSON válido: ${text.slice(0, 200)}`);
  return db.campaignAlert.update({ where: { id: alert.id }, data: { advice, adviceModel: model, adviceAt: new Date() } });
}
