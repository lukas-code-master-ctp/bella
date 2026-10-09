"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui";

const TABS = [
  ["meta", "Conexión con Meta"],
  ["assistant", "Ajustes de la asistente"],
] as const;

type Tab = (typeof TABS)[number][0];

export function CopyPrompt({ prompts }: { prompts: Record<Tab, string> }) {
  const [tab, setTab] = useState<Tab>("meta");
  const [copied, setCopied] = useState<Tab | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompts[tab]);
      setCopied(tab);
      setTimeout(() => setCopied(null), 2500);
    } catch {
      // Sin permiso del portapapeles: el texto queda seleccionable en el cuadro.
    }
  }

  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Qué configurar" className="flex flex-wrap gap-1.5">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`min-h-9 rounded-full px-3.5 text-sm font-semibold transition-colors duration-150 ${
              tab === id ? "bg-brand-600 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <textarea
        readOnly
        value={prompts[tab]}
        aria-label="Prompt para Claude"
        rows={14}
        onFocus={(e) => e.currentTarget.select()}
        className="block w-full rounded-lg border border-slate-300 bg-slate-50 p-3 font-mono text-[12px] leading-relaxed text-slate-800"
      />
      <Button onClick={copy}>
        {copied === tab ? <Check aria-hidden /> : <Copy aria-hidden />}
        {copied === tab ? "Copiado" : "Copiar prompt"}
      </Button>
    </div>
  );
}
