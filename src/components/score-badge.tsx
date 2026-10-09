import { Gauge } from "lucide-react";
import { scoreLevel, type ScoreLevel } from "@/lib/labels";
import { Badge } from "./ui";

const TONE = { alto: "success", medio: "warning", bajo: "neutral" } as const satisfies Record<ScoreLevel, string>;
const LABEL: Record<ScoreLevel, string> = { alto: "Alto", medio: "Medio", bajo: "Bajo" };

/** Puntaje del lead con su nivel (alto, medio, bajo). `title` muestra el motivo al pasar el mouse. */
export function ScoreBadge({ score, reason, className = "" }: { score: number; reason?: string | null; className?: string }) {
  const level = scoreLevel(score);
  return (
    <span title={reason ?? undefined} className={`inline-flex ${className}`}>
      <Badge tone={TONE[level]}>
        <Gauge aria-hidden />
        <span className="tabular-nums">{score}</span>
        <span className="sr-only">de 100,</span> {LABEL[level]}
      </Badge>
    </span>
  );
}
