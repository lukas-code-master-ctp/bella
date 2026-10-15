"use client";

import { useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

/**
 * Contrae el menú lateral a íconos para ganar ancho (útil en el funnel). Cambia el atributo en
 * #app-shell al tiro, sin volver a pedir la página, y guarda la preferencia en una cookie para
 * que el servidor ya la dibuje así la próxima vez.
 */
export function SidebarToggle({ initial }: { initial: boolean }) {
  const [compact, setCompact] = useState(initial);
  return (
    <button
      type="button"
      onClick={() => {
        const next = !compact;
        setCompact(next);
        document.getElementById("app-shell")?.setAttribute("data-compact", String(next));
        document.cookie = `nav=${next ? "compact" : "full"}; path=/; max-age=31536000; samesite=lax`;
      }}
      aria-label={compact ? "Expandir menú" : "Contraer menú"}
      aria-pressed={compact}
      title={compact ? "Expandir menú" : "Contraer menú"}
      className="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 text-sm font-medium text-slate-500 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-900 group-data-[compact=true]/shell:justify-center group-data-[compact=true]/shell:px-0 [&_svg]:size-[18px] [&_svg]:shrink-0"
    >
      {compact ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
      <span className="group-data-[compact=true]/shell:sr-only">Contraer menú</span>
    </button>
  );
}
