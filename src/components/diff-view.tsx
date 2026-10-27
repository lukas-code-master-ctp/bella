"use client";

import { useMemo } from "react";
import { diffHunks, lineDiff } from "@/lib/line-diff";

/** Antes y después de un texto, línea por línea: solo los cambios con algo de contexto. */
export function DiffView({ current, proposed, className = "" }: { current: string; proposed: string; className?: string }) {
  const hunks = useMemo(() => diffHunks(lineDiff(current, proposed)), [current, proposed]);
  return (
    <div className={`max-h-96 overflow-auto rounded-lg font-mono text-[12px] leading-relaxed ring-1 ring-inset ring-slate-200 ${className}`}>
      {hunks.length === 0 && <p className="p-3 font-sans text-sm text-slate-600">Sin cambios en el texto.</p>}
      {hunks.map((h, i) => (
        <div key={i}>
          {h.skippedBefore > 0 && (
            <p className="bg-slate-50 px-3 py-1 font-sans text-[11px] text-slate-500">
              {h.skippedBefore} {h.skippedBefore === 1 ? "línea igual" : "líneas iguales"}
            </p>
          )}
          {h.lines.map((l, j) => (
            <p
              key={j}
              className={`whitespace-pre-wrap break-words px-3 ${
                l.kind === "added" ? "bg-emerald-50 text-emerald-900" : l.kind === "removed" ? "bg-rose-50 text-rose-900 line-through decoration-rose-300" : "text-slate-600"
              }`}
            >
              <span aria-hidden className="mr-2 select-none text-slate-400">
                {l.kind === "added" ? "+" : l.kind === "removed" ? "−" : " "}
              </span>
              <span className="sr-only">{l.kind === "added" ? "Agregado: " : l.kind === "removed" ? "Quitado: " : ""}</span>
              {l.text || " "}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}
