"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { LinkPending } from "./link-pending";

/** Subpestañas de una sección (cada una es una página). La activa se marca con una línea de marca debajo. */
export function SubTabs({ label, tabs }: { label: string; tabs: readonly (readonly [href: string, label: string, icon: ReactNode, count?: number])[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="mb-6 overflow-x-auto border-b border-slate-200 [scrollbar-width:none]">
      <div className="flex gap-1">
        {tabs.map(([href, text, icon, count]) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`relative flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-t-lg px-3.5 text-sm font-semibold transition-colors duration-150 [&_svg]:size-4 ${
                active ? "text-brand-700 [&_svg]:text-brand-600" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 [&_svg]:text-slate-400"
              }`}
            >
              {icon}
              {text}
              {count !== undefined && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[11px] leading-none tabular-nums ${active ? "bg-brand-100 text-brand-800" : "bg-slate-100 text-slate-600"}`}
                >
                  {count}
                </span>
              )}
              {active && <span aria-hidden className="absolute inset-x-2 -bottom-px h-0.5 animate-indicator rounded-full bg-brand-600" />}
              <LinkPending />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
