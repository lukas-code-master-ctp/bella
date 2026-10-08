import { requireUser } from "@/lib/auth";
import { logoutAction } from "../login/actions";
import { NavLink } from "./nav-link";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-2 px-4 py-2">
          <span className="mr-4 text-lg font-bold text-brand-600">Bella</span>
          <nav className="flex flex-wrap gap-1">
            <NavLink href="/funnel">Funnel</NavLink>
            <NavLink href="/simulator">Simulador</NavLink>
            {user.role === "ADMIN" && <NavLink href="/settings">Configuración</NavLink>}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-slate-600">
              {user.name}{" "}
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                {user.role === "ADMIN" ? "Admin" : "Ejecutivo"}
              </span>
            </span>
            <form action={logoutAction}>
              <button className="text-slate-500 hover:text-slate-800">Salir</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-4 py-6">{children}</main>
    </div>
  );
}
