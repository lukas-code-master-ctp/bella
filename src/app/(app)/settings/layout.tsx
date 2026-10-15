import { Archive, ListChecks, Building2, KeyRound, FlaskConical, Power, Crosshair, Target, BellRing, BookOpen, Bot, ClipboardList, Contact, MessageSquareReply, MessagesSquare, Shuffle, SquareKanban, Users, Webhook } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { NavLink } from "../nav-link";
import { ScrollActiveIntoView } from "./scroll-active";

const GROUPS = [
  ["Empezar", [["/settings", "Configura tu empresa", <ListChecks key="i" />]]],
  [
    "Asistente IA",
    [
      ["/settings/assistant", "Asistente", <Bot key="i" />],
      ["/settings/ai-operation", "Funcionamiento IA", <Power key="i" />],
      ["/settings/knowledge", "Conocimiento", <BookOpen key="i" />],
      ["/settings/ab-tests", "Pruebas A/B", <FlaskConical key="i" />],
    ],
  ],
  [
    "Canales",
    [
      ["/settings/channels", "Canales", <MessagesSquare key="i" />],
      ["/settings/comment-rules", "Reglas de comentarios", <MessageSquareReply key="i" />],
      ["/settings/credentials", "Credenciales", <KeyRound key="i" />],
    ],
  ],
  [
    "Ventas",
    [
      ["/settings/funnel", "Funnel y etiquetas", <SquareKanban key="i" />],
      ["/settings/fields", "Campos del cliente", <ClipboardList key="i" />],
      ["/settings/rules", "Asignación", <Shuffle key="i" />],
      ["/settings/follow-ups", "Seguimientos", <BellRing key="i" />],
      ["/settings/auto-close", "Cierre automático", <Archive key="i" />],
    ],
  ],
  [
    "Marketing",
    [
      ["/settings/attribution", "Origen de leads", <Target key="i" />],
      ["/settings/pixel", "Píxel de Meta", <Crosshair key="i" />],
    ],
  ],
  [
    "Equipo y datos",
    [
      ["/settings/users", "Usuarios", <Users key="i" />],
      ["/settings/contacts", "Contactos", <Contact key="i" />],
      ["/settings/webhooks", "Webhooks", <Webhook key="i" />],
    ],
  ],
] as const;

/** Solo el dueño de Beliapp. */
const OWNER_GROUP = ["Beliapp", [["/settings/companies", "Empresas", <Building2 key="i" />]]] as const;

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  const groups = user.superadmin ? [...GROUPS, OWNER_GROUP] : GROUPS;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[220px_minmax(0,1fr)] lg:gap-8">
      <nav aria-label="Configuración" className="min-w-0 md:sticky md:top-8 md:max-h-[calc(100dvh-4rem)] lg:top-22 lg:max-h-[calc(100dvh-7.5rem)] md:self-start md:overflow-y-auto">
        {/* En móvil, una tira que se desliza de lado; en escritorio, grupos con su título. */}
        <div data-strip className="relative -mx-4 flex gap-1 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 [scrollbar-width:none] md:mx-0 md:flex-col md:gap-3 md:overflow-visible md:px-0 md:pb-0 [&_a]:shrink-0 [&_a]:whitespace-nowrap">
          {groups.map(([group, tabs]) => (
            <div key={group} role="group" aria-label={group} className="flex gap-1 md:flex-col md:gap-0.5">
              <p className="hidden px-3 pb-0.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 md:block">{group}</p>
              {tabs.map(([href, label, icon]) => (
                <NavLink key={href} href={href} icon={icon} label={label} exact={href === "/settings"} />
              ))}
            </div>
          ))}
        </div>
        <ScrollActiveIntoView />
      </nav>
      <div className="min-w-0 max-w-4xl">{children}</div>
    </div>
  );
}
