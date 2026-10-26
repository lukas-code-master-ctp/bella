"use client";

import { useRef, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

export type LeadTab = { id: string; label: string; count?: number; panel: ReactNode };

/**
 * Pestañas de la ficha del lead. La elegida queda en `?tab=` (se puede compartir y sobrevive al
 * refresco) pero cambia sin pedir nada al servidor: los paneles ya vienen renderizados y los
 * ocultos se conservan montados, así un formulario a medio llenar no se pierde al cambiar.
 */
export function LeadTabs({ tabs }: { tabs: LeadTab[] }) {
  const params = useSearchParams();
  const requested = params.get("tab");
  const current = tabs.some((t) => t.id === requested) ? requested! : tabs[0].id;
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function select(id: string, focus = false) {
    const next = new URLSearchParams(params);
    if (id === tabs[0].id) next.delete("tab");
    else next.set("tab", id);
    const qs = next.toString();
    // Next sincroniza useSearchParams con replaceState sin volver a renderizar en el servidor.
    window.history.replaceState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
    if (focus) refs.current[id]?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const i = tabs.findIndex((t) => t.id === current);
    const to =
      e.key === "ArrowRight" ? (i + 1) % tabs.length
      : e.key === "ArrowLeft" ? (i - 1 + tabs.length) % tabs.length
      : e.key === "Home" ? 0
      : e.key === "End" ? tabs.length - 1
      : null;
    if (to === null) return;
    e.preventDefault();
    select(tabs[to].id, true);
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label="Secciones de la ficha"
        onKeyDown={onKeyDown}
        className="z-10 flex @3xl:sticky @3xl:top-0 gap-0.5 rounded-xl border border-slate-200 bg-white/95 p-1 shadow-xs backdrop-blur"
      >
        {tabs.map((t) => {
          const active = t.id === current;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[t.id] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={active}
              aria-controls={`panel-${t.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => select(t.id)}
              className={`flex min-h-9 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg px-1.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-600 ${
                active ? "bg-brand-50 text-brand-800" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <span className="truncate">{t.label}</span>
              {t.count ? (
                <span className={`shrink-0 rounded-full px-1.5 text-xs tabular-nums ${active ? "bg-brand-100 text-brand-800" : "bg-slate-100 text-slate-600"}`}>
                  {t.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" id={`panel-${t.id}`} aria-labelledby={`tab-${t.id}`} hidden={t.id !== current} className="mt-4 space-y-4">
          {t.panel}
        </div>
      ))}
    </div>
  );
}
