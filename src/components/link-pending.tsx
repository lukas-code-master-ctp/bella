"use client";

import { useLinkStatus } from "next/link";

/**
 * Indicador de navegación en curso. Va dentro de un <Link>: mientras carga la página de
 * destino muestra una barra animada en el borde inferior del enlace.
 */
export function LinkPending({ className = "" }: { className?: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span aria-hidden className={`pointer-events-none absolute animate-fade-in [animation-delay:120ms] inset-x-0 bottom-0 h-0.5 overflow-hidden rounded-full ${className}`}>
      <span className="block h-full w-2/5 animate-progress rounded-full bg-brand-600" />
    </span>
  );
}
