import type { BroadcastStatus } from "@prisma/client";
import type { BroadcastStats } from "@/lib/domain/broadcasts";
import { Badge } from "@/components/ui";

const STATUS: Record<BroadcastStatus, { label: string; tone: "brand" | "success" | "warning" | "neutral" }> = {
  SCHEDULED: { label: "Programado", tone: "neutral" },
  SENDING: { label: "Enviando", tone: "brand" },
  PAUSED: { label: "Pausado", tone: "warning" },
  DONE: { label: "Enviado", tone: "success" },
  CANCELED: { label: "Cancelado", tone: "neutral" },
};

export function BroadcastStatusBadge({ status, stats }: { status: BroadcastStatus; stats?: BroadcastStats }) {
  const s = STATUS[status];
  const progress = status === "SENDING" && stats ? ` ${(stats.total - stats.pending).toLocaleString("es-CL")} de ${stats.total.toLocaleString("es-CL")}` : "";
  return <Badge tone={s.tone}>{s.label + progress}</Badge>;
}

export const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "–");

/** Barra apilada: leídos (incluye respondieron), entregados sin leer y fallidos, sobre el total. */
export function ResultBar({ stats }: { stats: BroadcastStats }) {
  const w = (n: number) => `${stats.total ? (n / stats.total) * 100 : 0}%`;
  return (
    <div
      className="flex h-2 w-32 overflow-hidden rounded-full bg-slate-100"
      role="img"
      aria-label={`${stats.delivered} entregados, ${stats.read} leídos, ${stats.replied} respondieron, ${stats.failed} fallaron`}
    >
      <span className="bg-brand-600" style={{ width: w(stats.replied) }} />
      <span className="bg-brand-300" style={{ width: w(stats.read - stats.replied) }} />
      <span className="bg-sky-brand" style={{ width: w(stats.delivered - stats.read) }} />
      <span className="bg-rose-400" style={{ width: w(stats.failed) }} />
    </div>
  );
}

export const dateTime = (d: Date) =>
  d.toLocaleString("es-CL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Santiago" });
