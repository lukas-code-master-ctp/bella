import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { SpendRow } from "@/lib/domain/ai-usage";

const usd = (v: number) => (v > 0 && v < 0.01 ? "< US$0.01" : `US$${v.toFixed(2)}`);

function Change({ value }: { value: number | null }) {
  if (value === null) return <span className="text-slate-400">—</span>;
  const pct = Math.round(Math.abs(value));
  if (pct === 0) return <span className="text-slate-500">= 0%</span>;
  const up = value > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 font-medium ${up ? "text-rose-600" : "text-emerald-600"}`}>
      <Icon aria-hidden className="size-3.5" />
      <span className="sr-only">{up ? "subió" : "bajó"}</span>
      {pct}%
    </span>
  );
}

/** Tabla compacta de gasto en IA por período, con la variación contra el período anterior. */
export function AiSpend({ rows }: { rows: SpendRow[] | null }) {
  return (
    <div className="mt-5 border-t border-slate-100 pt-4">
      <h3 className="text-sm font-semibold text-slate-900">Consumo</h3>
      {rows ? (
        <table className="mt-2 w-full max-w-sm text-sm">
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-slate-100 last:border-0">
                <td className="py-1.5 text-slate-600">{r.label}</td>
                <td className="py-1.5 text-right tabular-nums font-medium text-slate-900">{usd(r.cost)}</td>
                <td className="w-20 py-1.5 text-right tabular-nums text-xs">
                  <Change value={r.change} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mt-1 text-sm text-slate-500">Todavía no hay consumo registrado.</p>
      )}
      <p className="mt-2 text-xs text-slate-500">
        La variación compara con el período anterior equivalente. Solo cuenta llamadas por OpenRouter.
      </p>
    </div>
  );
}
