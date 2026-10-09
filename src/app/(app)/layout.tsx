import { Bell, FlaskConical, LogOut, Settings, SquareKanban } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { Avatar } from "@/components/ui";
import { logoutAction } from "../login/actions";
import { NavLink } from "./nav-link";
import { Logo } from "@/components/logo";
import { unreadNotificationCount } from "@/lib/domain/notifications";
import { UnreadBadge } from "./notifications/unread-badge";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const unread = await unreadNotificationCount(user.id);
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <a
        href="#contenido"
        className="sr-only z-50 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-brand-700 shadow-lg focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Saltar al contenido
      </a>
      <aside className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur-md lg:flex lg:h-dvh lg:flex-col lg:border-b-0 lg:border-r lg:bg-white">
        <div className="flex items-center gap-3 px-4 py-2.5 lg:px-5 lg:py-5">
          <Logo />
          <div className="ml-auto flex items-center gap-1 lg:hidden">
            <Avatar name={user.name} size="sm" />
            <form action={logoutAction}>
              <button
                aria-label="Cerrar sesión"
                className="flex size-10 items-center justify-center rounded-lg text-slate-500 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-900"
              >
                <LogOut aria-hidden className="size-[18px]" />
              </button>
            </form>
          </div>
        </div>
        <nav aria-label="Principal" className="flex flex-wrap gap-1 px-3 pb-2 lg:flex-1 lg:flex-col lg:flex-nowrap lg:px-3 lg:pb-0">
          <NavLink href="/funnel" icon={<SquareKanban />}>
            Funnel
          </NavLink>
          <NavLink href="/notifications" icon={<Bell />}>
            Avisos
            <UnreadBadge initial={unread} />
          </NavLink>
          <NavLink href="/simulator" icon={<FlaskConical />}>
            Simulador
          </NavLink>
          {user.role === "ADMIN" && (
            <NavLink href="/settings" icon={<Settings />}>
              Configuración
            </NavLink>
          )}
        </nav>
        <div className="hidden items-center gap-3 border-t border-slate-200 p-4 lg:flex">
          <Avatar name={user.name} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900" title={user.name}>
              {user.name}
            </p>
            <p className="text-xs text-slate-600">{user.role === "ADMIN" ? "Administrador" : "Ejecutivo"}</p>
          </div>
          <form action={logoutAction}>
            <button
              aria-label="Cerrar sesión"
              title="Cerrar sesión"
              className="flex size-10 items-center justify-center rounded-lg text-slate-500 transition-colors duration-150 hover:bg-rose-50 hover:text-rose-700"
            >
              <LogOut aria-hidden className="size-[18px]" />
            </button>
          </form>
        </div>
      </aside>
      <main id="contenido" tabIndex={-1} className="min-w-0 px-4 py-6 focus:outline-none sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-[1440px]">{children}</div>
      </main>
    </div>
  );
}
