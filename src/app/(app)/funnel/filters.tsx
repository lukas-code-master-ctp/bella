"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

type Option = { value: string; label: string };

/**
 * Selector del encabezado del funnel que se aplica al elegir (sin botón "Aplicar"):
 * cambia un parámetro de la URL, así el filtro se puede compartir y sobrevive al volver.
 */
export function ParamSelect({ name, label, value, options, className = "" }: { name: string; label: string; value: string; options: Option[]; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  return (
    <>
      <label htmlFor={`f-${name}`} className="sr-only">
        {label}
      </label>
      <select
        id={`f-${name}`}
        key={value}
        defaultValue={value}
        aria-busy={pending}
        onChange={(e) => {
          const next = new URLSearchParams(params);
          if (e.target.value) next.set(name, e.target.value);
          else next.delete(name);
          const qs = next.toString();
          startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
        }}
        className={`h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-sm font-medium text-slate-800 shadow-xs transition-[border-color,opacity] duration-150 hover:border-slate-400 focus:border-brand-500 focus:outline-none focus:ring-3 focus:ring-brand-500/20 ${pending ? "opacity-60" : ""} ${className}`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </>
  );
}
