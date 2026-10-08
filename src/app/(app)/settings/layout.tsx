import { requireAdmin } from "@/lib/auth";
import { NavLink } from "../nav-link";

const TABS = [
  ["/settings/assistant", "Asistente"],
  ["/settings/funnel", "Funnel y etiquetas"],
  ["/settings/rules", "Asignación"],
  ["/settings/knowledge", "Base de conocimiento"],
  ["/settings/inventory", "Inventario"],
  ["/settings/users", "Usuarios"],
] as const;

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="grid gap-6 md:grid-cols-[200px_1fr]">
      <nav className="flex flex-row flex-wrap gap-1 md:flex-col">
        {TABS.map(([href, label]) => (
          <NavLink key={href} href={href}>
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
