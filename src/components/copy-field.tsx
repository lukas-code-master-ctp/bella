"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** Texto para copiar (URL, código) con su botón de copiar. `block` lo muestra como bloque de código. */
export function CopyField({ value, label, block }: { value: string; label?: string; block?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Sin permiso del portapapeles: el texto igual se puede seleccionar.
    }
  }
  return (
    <div className="group relative rounded-lg border border-slate-200 bg-slate-50">
      {block ? (
        <pre className="overflow-x-auto p-3 pr-24 font-mono text-[12px] leading-relaxed text-slate-800">{value}</pre>
      ) : (
        <code className="block break-all p-3 pr-24 font-mono text-[13px] text-brand-700">{value}</code>
      )}
      <button
        type="button"
        onClick={copy}
        aria-label={label ? `Copiar ${label}` : "Copiar"}
        className={`absolute right-2 top-2 inline-flex min-h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold shadow-xs transition-colors duration-150 [&_svg]:size-3.5 ${
          copied ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
        }`}
      >
        {copied ? <Check aria-hidden className="animate-pop" /> : <Copy aria-hidden />}
        {copied ? "Copiado" : "Copiar"}
      </button>
    </div>
  );
}
