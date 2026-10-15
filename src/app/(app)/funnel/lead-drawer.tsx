"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Maximize2, X } from "lucide-react";

/**
 * Panel lateral con la conversación y la ficha de un lead, sobre el funnel (/funnel?lead=…).
 * El tablero queda detrás con su scroll y filtros; Esc, la X o el fondo lo cierran.
 */
export function LeadDrawer({ closeHref, fullHref, children }: { closeHref: string; fullHref: string; children: React.ReactNode }) {
  const router = useRouter();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // Un diálogo o menú abierto dentro del panel se cierra primero con su propio Esc.
      if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector("dialog[open]")) router.push(closeHref, { scroll: false });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeHref, router]);

  return (
    <div className="fixed inset-0 z-40">
      <Link href={closeHref} scroll={false} aria-label="Cerrar" tabIndex={-1} className="absolute inset-0 animate-fade-in bg-slate-900/25" />
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Lead"
        className="absolute inset-x-0 bottom-0 top-[6dvh] flex animate-sheet-up flex-col overflow-y-auto overscroll-contain rounded-t-2xl bg-slate-50 shadow-2xl outline-none md:inset-y-0 md:left-auto md:right-0 md:w-full md:max-w-[720px] md:animate-slide-in-right md:rounded-none"
      >
        <div className="sticky top-0 z-10 flex items-center justify-end gap-1 border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur">
          {/* En el teléfono el panel es una hoja que sube desde abajo. */}
          <span aria-hidden className="absolute left-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-slate-300 md:hidden" />
          <Link href={fullHref} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100">
            <Maximize2 aria-hidden className="size-4" />
            Ficha completa
          </Link>
          <Link href={closeHref} scroll={false} aria-label="Cerrar" className="flex size-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900">
            <X aria-hidden className="size-5" />
          </Link>
        </div>
        <div className="p-3 sm:p-4">{children}</div>
      </div>
    </div>
  );
}
