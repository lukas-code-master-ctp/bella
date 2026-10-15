"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bell, Ellipsis, ListTodo, MessagesSquare, SquareKanban, X } from "lucide-react";

/**
 * Barra inferior del teléfono con los 5 destinos del día a día. "Más" abre una hoja desde abajo
 * con el resto (Métricas, Configuración, perfil); su contenido llega armado desde el servidor.
 */
export function BottomNav({
  badges,
  more,
  moreActive,
}: {
  badges: { chats?: React.ReactNode; tasks?: React.ReactNode; notifications?: React.ReactNode; more?: React.ReactNode };
  more: React.ReactNode;
  /** Rutas que viven dentro de "Más", para marcarlo como activo. */
  moreActive: string[];
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const sheetRef = useRef<HTMLDialogElement>(null);
  const is = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  useEffect(() => {
    const d = sheetRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  // Al navegar desde la hoja, se cierra.
  useEffect(() => setOpen(false), [pathname]);

  const item = (href: string, label: string, icon: React.ReactNode, badge?: React.ReactNode) => (
    <Link
      href={href}
      aria-current={is(href) ? "page" : undefined}
      className={`relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors duration-150 [&_svg]:size-[22px] ${
        is(href) ? "text-brand-700" : "text-slate-600"
      }`}
    >
      <span className="relative">
        {icon}
        {badge && <span className="absolute -right-3 -top-1.5 flex">{badge}</span>}
      </span>
      {label}
    </Link>
  );

  return (
    <>
      <nav
        aria-label="Principal"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      >
        {item("/funnel", "Funnel", <SquareKanban aria-hidden />)}
        {item("/chats", "Chats", <MessagesSquare aria-hidden />, badges.chats)}
        {item("/tasks", "Tareas", <ListTodo aria-hidden />, badges.tasks)}
        {item("/notifications", "Avisos", <Bell aria-hidden />, badges.notifications)}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className={`relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium [&_svg]:size-[22px] ${
            moreActive.some(is) ? "text-brand-700" : "text-slate-600"
          }`}
        >
          <span className="relative">
            <Ellipsis aria-hidden />
            {badges.more && <span className="absolute -right-3 -top-1.5 flex">{badges.more}</span>}
          </span>
          Más
        </button>
      </nav>
      <dialog
        ref={sheetRef}
        onClose={() => setOpen(false)}
        onClick={(e) => e.target === sheetRef.current && setOpen(false)}
        aria-label="Más opciones"
        className="mb-0 mt-auto w-full max-w-none rounded-t-2xl bg-white p-0 pb-[env(safe-area-inset-bottom)] shadow-2xl backdrop:bg-slate-900/40 open:animate-sheet-up lg:hidden"
      >
        <div className="flex items-center justify-between px-4 pb-1 pt-3">
          <span aria-hidden className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-slate-300" />
          <h2 className="pt-2 text-sm font-semibold text-slate-900">Más</h2>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={() => setOpen(false)}
            className="flex size-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>
        {/* Cierra también al tocar la página en la que ya estás (ahí no cambia la ruta). */}
        <div className="px-2 pb-3" onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)}>
          {more}
        </div>
      </dialog>
    </>
  );
}
