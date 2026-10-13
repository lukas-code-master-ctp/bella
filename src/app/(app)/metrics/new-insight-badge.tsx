"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/** "Nuevo" de Métricas en el menú: desaparece apenas se entra a Métricas. */
export function NewInsightBadge() {
  const pathname = usePathname();
  const [seen, setSeen] = useState(false);
  const inMetrics = pathname === "/metrics" || pathname.startsWith("/metrics/");
  useEffect(() => {
    if (inMetrics) setSeen(true);
  }, [inMetrics]);
  if (seen || inMetrics) return null;
  return (
    <span className="ml-auto rounded-full bg-brand-600 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">
      <span className="sr-only">, resumen semanal </span>
      Nuevo
    </span>
  );
}
