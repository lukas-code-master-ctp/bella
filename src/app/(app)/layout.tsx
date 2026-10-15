import Link from "next/link";
import { cookies } from "next/headers";
import { Bell, Building2, ChartNoAxesColumn, Check, ChevronDown, ListTodo, LogOut, MessagesSquare, Settings, SquareKanban, UserRoundCog } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { afterInCompany } from "@/lib/company-request";
import { runDueFollowUpsIfStale } from "@/lib/ai/follow-ups";
import { countUrgentTasks } from "@/lib/domain/tasks";
import { countPendingComments } from "@/lib/domain/comments";
import { hasUnseenInsight } from "@/lib/ai/weekly-insights";
import { companyName, companyOptions } from "@/lib/domain/companies";
import { currentCompanyId } from "@/lib/tenant";
import { Avatar, dropdownItemClass } from "@/components/ui";
import { Dropdown } from "@/components/dropdown";
import { logoutAction } from "../login/actions";
import { enterCompanyAction } from "./settings/companies/actions";
import { NavLink } from "./nav-link";
import { SidebarToggle } from "./sidebar-toggle";
import { CommandSearch } from "./command-search";
import { NewLead } from "./new-lead";
import { BottomNav } from "./bottom-nav";
import { NewInsightBadge } from "./metrics/new-insight-badge";
import { Logo } from "@/components/logo";
import { unreadNotificationCount } from "@/lib/domain/notifications";
import { UnreadBadge } from "./notifications/unread-badge";

const countBadge = (n: number, tone: string, label: string) => (
  <span key={n} className={`animate-pop rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none tabular-nums text-white ${tone}`}>
    <span className="sr-only">, </span>
    {n}
    <span className="sr-only"> {label}</span>
  </span>
);

const iconButton =
  "relative flex size-10 items-center justify-center rounded-lg text-slate-600 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-900";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // Además del cron (cada 15 minutos), mientras el equipo usa la app los seguimientos
  // vencidos se envían después de responder la página (como mucho cada 5 minutos).
  await afterInCompany(runDueFollowUpsIfStale);
  const companyId = await currentCompanyId();
  const [urgentTasks, unread, pendingComments, newInsight, company, companies, cookieStore] = await Promise.all([
    countUrgentTasks(user.id),
    unreadNotificationCount(user.id),
    countPendingComments(),
    user.role === "ADMIN" && hasUnseenInsight(user.id),
    companyName(companyId),
    user.superadmin ? companyOptions() : [],
    cookies(),
  ]);
  const compact = cookieStore.get("nav")?.value === "compact";

  const bell = (
    <Link href="/notifications" className={iconButton} title="Avisos">
      <Bell aria-hidden className="size-5" />
      <span className="sr-only">Avisos</span>
      <span className="absolute -right-0.5 -top-0.5 flex">
        <UnreadBadge initial={unread} />
      </span>
    </Link>
  );

  const profile = (
    <Dropdown label="Menú de tu cuenta" button={<Avatar name={user.name} size="sm" />} buttonClassName={`${iconButton} rounded-full`}>
      <div className="border-b border-slate-100 px-3 pb-2 pt-1.5">
        <p className="truncate text-sm font-semibold text-slate-900">{user.name}</p>
        <p className="truncate text-xs text-slate-600">{user.role === "ADMIN" ? "Administrador" : "Ejecutivo"}</p>
      </div>
      <div className="pt-1">
        <Link href="/profile" role="menuitem" tabIndex={-1} className={dropdownItemClass()}>
          <UserRoundCog aria-hidden />
          Mi perfil
        </Link>
        <form action={logoutAction}>
          <button role="menuitem" tabIndex={-1} className={dropdownItemClass(true)}>
            <LogOut aria-hidden />
            Cerrar sesión
          </button>
        </form>
      </div>
    </Dropdown>
  );

  return (
    <div
      id="app-shell"
      data-compact={compact}
      className="group/shell min-h-dvh lg:grid lg:grid-cols-[248px_minmax(0,1fr)] lg:data-[compact=true]:grid-cols-[72px_minmax(0,1fr)]"
    >
      <a
        href="#contenido"
        className="sr-only z-50 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-brand-700 shadow-lg focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Saltar al contenido
      </a>
      <aside className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur-md lg:flex lg:h-dvh lg:flex-col lg:border-b-0 lg:border-r lg:bg-white">
        <div className="flex items-center gap-1 px-4 py-2.5 lg:h-14 lg:px-5 lg:py-0 lg:group-data-[compact=true]/shell:justify-center lg:group-data-[compact=true]/shell:px-0">
          <Link href="/funnel" aria-label="Ir al funnel" className="mr-auto overflow-hidden rounded-lg lg:group-data-[compact=true]/shell:mr-0 lg:group-data-[compact=true]/shell:w-9">
            <Logo />
          </Link>
          {/* En pantallas chicas no hay barra superior: la búsqueda y "Nuevo lead" van aquí, y el resto en la barra inferior. */}
          <div className="flex items-center gap-1 lg:hidden">
            <CommandSearch compact />
            <NewLead compact />
          </div>
        </div>
        <nav aria-label="Principal" className="mt-3 hidden flex-1 flex-col gap-1 px-3 pb-3 lg:flex">
          <div role="group" aria-labelledby="nav-trabajo" className="space-y-1">
            <p id="nav-trabajo" className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500 lg:group-data-[compact=true]/shell:sr-only">
              Trabajo
            </p>
            <NavLink compactable href="/funnel" icon={<SquareKanban />} label="Funnel" />
            <NavLink compactable
              href="/chats"
              icon={<MessagesSquare />}
              label="Chats"
              badge={pendingComments > 0 && countBadge(pendingComments, "bg-brand-600", "pendientes")}
            />
            <NavLink compactable
              href="/tasks"
              icon={<ListTodo />}
              label={user.role === "ADMIN" ? "Tareas" : "Mis tareas"}
              badge={urgentTasks > 0 && countBadge(urgentTasks, "bg-rose-600", "vencidas o para hoy")}
            />
          </div>
          <div role="group" aria-labelledby="nav-analisis" className="mt-5 space-y-1 lg:group-data-[compact=true]/shell:mt-3 lg:group-data-[compact=true]/shell:border-t lg:group-data-[compact=true]/shell:border-slate-100 lg:group-data-[compact=true]/shell:pt-3">
            <p id="nav-analisis" className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500 lg:group-data-[compact=true]/shell:sr-only">
              Análisis
            </p>
            <NavLink compactable href="/metrics" icon={<ChartNoAxesColumn />} label="Métricas" badge={newInsight && <NewInsightBadge />} />
          </div>
          <div className="mt-auto space-y-1 border-t border-slate-100 pt-3">
            {user.role === "ADMIN" && <NavLink compactable href="/settings" icon={<Settings />} label="Configuración" />}
            <SidebarToggle initial={compact} />
          </div>
        </nav>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-20 hidden h-14 items-center gap-4 border-b border-slate-200 bg-white/90 px-8 backdrop-blur-md lg:flex">
          {user.superadmin ? (
            <Dropdown
              label={`Empresa: ${company ?? "sin nombre"}. Cambiar de empresa`}
              align="left"
              width="w-72"
              buttonClassName="flex h-9 max-w-56 items-center gap-2 rounded-lg px-2.5 text-sm font-semibold text-slate-800 transition-colors duration-150 hover:bg-slate-100"
              button={
                <>
                  <Building2 aria-hidden className="size-4 shrink-0 text-slate-500" />
                  <span className="truncate">{company}</span>
                  <ChevronDown aria-hidden className="size-4 shrink-0 text-slate-500" />
                </>
              }
            >
              <div className="max-h-80 overflow-y-auto">
                {companies.map((c) => (
                  <form key={c.id} action={enterCompanyAction.bind(null, c.id)}>
                    <button role="menuitem" tabIndex={-1} aria-current={c.id === companyId ? "true" : undefined} className={dropdownItemClass()}>
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      {c.id === companyId && <Check aria-hidden className="text-brand-600" />}
                    </button>
                  </form>
                ))}
              </div>
              <div className="mt-1 border-t border-slate-100 pt-1">
                <Link href="/settings/companies" role="menuitem" tabIndex={-1} className={dropdownItemClass()}>
                  <Settings aria-hidden />
                  Administrar empresas
                </Link>
              </div>
            </Dropdown>
          ) : (
            <p className="flex max-w-56 items-center gap-2 text-sm font-semibold text-slate-800">
              <Building2 aria-hidden className="size-4 shrink-0 text-slate-500" />
              <span className="truncate">{company}</span>
            </p>
          )}
          <div className="flex flex-1 justify-center">
            <CommandSearch />
          </div>
          <div className="flex items-center gap-1">
            <NewLead />
            <span className="w-2" />
            {bell}
            {profile}
          </div>
        </header>
        <main id="contenido" tabIndex={-1} className="min-w-0 px-4 pb-28 pt-6 focus:outline-none sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto max-w-[1440px]">{children}</div>
        </main>
      </div>
      <BottomNav
        moreActive={["/metrics", "/settings", "/profile"]}
        badges={{
          chats: pendingComments > 0 && countBadge(pendingComments, "bg-brand-600", "pendientes"),
          tasks: urgentTasks > 0 && countBadge(urgentTasks, "bg-rose-600", "vencidas o para hoy"),
          notifications: <UnreadBadge initial={unread} />,
          more: newInsight && <NewInsightBadge />,
        }}
        more={
          <>
            {company && (
              <p className="flex items-center gap-2 px-3 pb-2 text-xs text-slate-600">
                <Building2 aria-hidden className="size-3.5" />
                {user.superadmin ? (
                  <Link href="/settings/companies" className="font-medium text-brand-700 underline-offset-2 hover:underline">
                    {company} · cambiar
                  </Link>
                ) : (
                  company
                )}
              </p>
            )}
            <Link href="/metrics" className={dropdownItemClass()}>
              <ChartNoAxesColumn aria-hidden />
              Métricas
              {newInsight && <span className="ml-auto">{<NewInsightBadge />}</span>}
            </Link>
            {user.role === "ADMIN" && (
              <Link href="/settings" className={dropdownItemClass()}>
                <Settings aria-hidden />
                Configuración
              </Link>
            )}
            <Link href="/profile" className={dropdownItemClass()}>
              <UserRoundCog aria-hidden />
              Mi perfil · {user.name}
            </Link>
            <form action={logoutAction}>
              <button className={dropdownItemClass(true)}>
                <LogOut aria-hidden />
                Cerrar sesión
              </button>
            </form>
          </>
        }
      />
    </div>
  );
}
