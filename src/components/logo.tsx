import { Sparkles } from "lucide-react";

export function Logo({ inverted = false }: { inverted?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span
        className={`flex size-9 items-center justify-center rounded-xl shadow-sm ${
          inverted ? "bg-white/15 text-white ring-1 ring-white/25" : "bg-gradient-to-br from-brand-500 to-brand-700 text-white"
        }`}
      >
        <Sparkles aria-hidden className="size-5" />
      </span>
      <span className={`text-lg font-bold tracking-tight ${inverted ? "text-white" : "text-slate-900"}`}>Bella</span>
    </span>
  );
}
