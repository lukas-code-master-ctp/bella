"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui";

export function CopyPrompt({ prompt }: { prompt: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Sin permiso del portapapeles: el texto queda seleccionable en el cuadro.
    }
  }

  return (
    <div className="space-y-3">
      <textarea
        readOnly
        value={prompt}
        aria-label="Prompt para Claude"
        rows={14}
        onFocus={(e) => e.currentTarget.select()}
        className="block w-full rounded-lg border border-slate-300 bg-slate-50 p-3 font-mono text-[12px] leading-relaxed text-slate-800"
      />
      <Button onClick={copy}>
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        {copied ? "Copiado" : "Copiar prompt"}
      </Button>
    </div>
  );
}
