import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { SpendRow } from "@/lib/domain/ai-usage";
import { PanelBody } from "@/components/settings-ui";

const usd = (v: number) => (v > 0 && v < 0.01 ? "< US$0.01" : `US$${v.toFixed(2)}`);

function Change({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-slate-400">Sin período anterior</span>;
  const pct = Math.round(Math.abs(value));
  if (pct === 0) return <span className="text-xs text-slate-500">= 0% vs. anterior</span>;
  const up = value > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-semibold ${up ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}
    >
      <Icon aria-hidden className="size-3.5" />
      <span className="sr-only">{up ? "subió" : "bajó"}</span>
      {pct}%
    </span>
  );
}

/** Gasto en IA por período en tarjetas, con la variación contra el período anterior. */
export function AiSpend({ rows }: { rows: SpendRow[] | null }) {
  return (
    <PanelBody>
      {rows ? (
        <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {rows.map((r) => (
            <div key={r.label} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <p className="text-xs font-medium text-slate-600">{r.label}</p>
              <p className="mt-1 text-2xl font-bold tracking-tight text-slate-900 tabular-nums">{usd(r.cost)}</p>
              <div className="mt-1">
                <Change value={r.change} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-500">Todavía no hay consumo registrado.</p>
      )}
      <p className="text-xs text-slate-500">Solo cuenta llamadas por OpenRouter.</p>
    </PanelBody>
  );
}
