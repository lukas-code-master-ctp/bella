import type { Channel } from "@prisma/client";

export const CHANNEL_LABEL: Record<Channel, string> = {
  SIMULATOR: "Simulador",
  WHATSAPP: "WhatsApp",
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
};

export type ScoreLevel = "bajo" | "medio" | "alto";

/** Nivel del puntaje del lead (0-100). Los cortes coinciden con la guía que recibe la IA en insights.ts. */
export function scoreLevel(score: number): ScoreLevel {
  return score >= 70 ? "alto" : score >= 40 ? "medio" : "bajo";
}
