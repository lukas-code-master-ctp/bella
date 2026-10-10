import { Archive, Power, Crosshair, Target, BellRing, BookOpen, Bot, ClipboardList, MessagesSquare, Package, Shuffle, SquareKanban, Users } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { NavLink } from "../nav-link";

const TABS = [
  ["/settings/assistant", "Asistente", <Bot key="i" />],
  ["/settings/ai-operation", "Funcionamiento IA", <Power key="i" />],
  ["/settings/channels", "Canales", <MessagesSquare key="i" />],
  ["/settings/attribution", "Origen de leads", <Target key="i" />],
  ["/settings/pixel", "Píxel de Meta", <Crosshair key="i" />],
  ["/settings/funnel", "Funnel y etiquetas", <SquareKanban key="i" />],
  ["/settings/fields", "Campos del cliente", <ClipboardList key="i" />],
  ["/settings/rules", "Asignación", <Shuffle key="i" />],
  ["/settings/follow-ups", "Seguimientos", <BellRing key="i" />],
  ["/settings/auto-close", "Cierre automático", <Archive key="i" />],
  ["/settings/knowledge", "Base de conocimiento", <BookOpen key="i" />],
  ["/settings/inventory", "Inventario", <Package key="i" />],
  ["/settings/users", "Usuarios", <Users key="i" />],
] as const;

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="grid gap-6 md:grid-cols-[220px_minmax(0,1fr)] lg:gap-8">
      <nav aria-label="Configuración" className="md:sticky md:top-8 md:self-start">
        <p className="mb-2 hidden px-3 text-xs font-semibold uppercase tracking-wide text-slate-500 md:block">Configuración</p>
        <div className="flex flex-wrap gap-1 md:flex-col">
          {TABS.map(([href, label, icon]) => (
            <NavLink key={href} href={href} icon={icon}>
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
      <div className="min-w-0 max-w-4xl">{children}</div>
    </div>
  );
}
