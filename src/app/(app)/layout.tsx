import Link from "next/link";
import { Bell, ChartNoAxesColumn, ListTodo, LogOut, MessagesSquare, Settings, SquareKanban, UserRoundCog } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { afterInCompany } from "@/lib/company-request";
import { runDueFollowUpsIfStale } from "@/lib/ai/follow-ups";
import { countUrgentTasks } from "@/lib/domain/tasks";
import { countPendingComments } from "@/lib/domain/comments";
import { hasUnseenInsight } from "@/lib/ai/weekly-insights";
import { companyName } from "@/lib/domain/companies";
import { currentCompanyId } from "@/lib/tenant";
import { Avatar } from "@/components/ui";
import { logoutAction } from "../login/actions";
import { NavLink } from "./nav-link";
import { NewInsightBadge } from "./metrics/new-insight-badge";
import { Logo } from "@/components/logo";
import { unreadNotificationCount } from "@/lib/domain/notifications";
import { UnreadBadge } from "./notifications/unread-badge";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // Además del cron (cada 15 minutos), mientras el equipo usa la app los seguimientos
  // vencidos se envían después de responder la página (como mucho cada 5 minutos).
  await afterInCompany(runDueFollowUpsIfStale);
  const [urgentTasks, unread, pendingComments, newInsight] = await Promise.all([
    countUrgentTasks(user.id),
    unreadNotificationCount(user.id),
    countPendingComments(),
    user.role === "ADMIN" && hasUnseenInsight(user.id),
  ]);
  // El dueño de Bella puede estar en cualquier empresa: se le muestra en cuál.
  const company = user.superadmin ? await companyName(await currentCompanyId()) : null;
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
            <Link
              href="/profile"
              aria-label="Mi perfil"
              title="Mi perfil"
              className="flex size-10 items-center justify-center rounded-lg transition-colors duration-150 hover:bg-slate-100"
            >
              <Avatar name={user.name} size="sm" />
            </Link>
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
          <NavLink href="/chats" icon={<MessagesSquare />}>
            Chats
            {pendingComments > 0 && (
              <span className="ml-auto rounded-full bg-brand-600 px-1.5 py-0.5 text-[11px] font-semibold leading-none tabular-nums text-white">
                <span className="sr-only">, </span>
                {pendingComments}
                <span className="sr-only"> pendientes</span>
              </span>
            )}
          </NavLink>
          <NavLink href="/notifications" icon={<Bell />}>
            Avisos
            <UnreadBadge initial={unread} />
          </NavLink>
          <NavLink href="/tasks" icon={<ListTodo />}>
            {user.role === "ADMIN" ? "Tareas" : "Mis tareas"}
            {urgentTasks > 0 && (
              <span key={urgentTasks} className="ml-auto animate-pop rounded-full bg-rose-600 px-1.5 py-0.5 text-[11px] font-semibold leading-none tabular-nums text-white">
                <span className="sr-only">, </span>
                {urgentTasks}
                <span className="sr-only"> vencidas o para hoy</span>
              </span>
            )}
          </NavLink>
          <NavLink href="/metrics" icon={<ChartNoAxesColumn />}>
            Métricas
            {newInsight && <NewInsightBadge />}
          </NavLink>
          {user.role === "ADMIN" && (
            <NavLink href="/settings" icon={<Settings />}>
              Configuración
            </NavLink>
          )}
        </nav>
        <div className="hidden items-center gap-3 border-t border-slate-200 p-4 lg:flex">
          <Link href="/profile" tabIndex={-1} aria-hidden className="rounded-full transition-opacity duration-150 hover:opacity-80">
            <Avatar name={user.name} />
          </Link>
          <div className="min-w-0 flex-1">
            <Link
              href="/profile"
              className="flex items-center gap-1 text-sm font-semibold text-slate-900 hover:text-brand-700"
              title="Mi perfil: nombre y contraseña"
            >
              <span className="truncate">{user.name}</span>
              <UserRoundCog aria-hidden className="size-3.5 shrink-0 text-slate-400" />
            </Link>
            {company ? (
              <Link href="/settings/companies" className="block truncate text-xs text-brand-700 hover:underline" title="Cambiar de empresa">
                {company}
              </Link>
            ) : (
              <p className="text-xs text-slate-600">{user.role === "ADMIN" ? "Administrador" : "Ejecutivo"}</p>
            )}
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
