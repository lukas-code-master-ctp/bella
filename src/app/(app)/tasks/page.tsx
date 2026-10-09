import { AlarmClock, CalendarClock, CalendarDays, CircleCheck, ListTodo } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { listTasks, type TaskWithLead } from "@/lib/domain/tasks";
import { buttonClass, Card, EmptyState, inputClass, PageHeader } from "@/components/ui";
import { TaskItem } from "./task-item";

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ executive?: string }> }) {
  const user = await requireUser();
  const { executive } = await searchParams;
  const isAdmin = user.role === "ADMIN";
  // El ejecutivo ve sus tareas; el admin, las de todos o las de un ejecutivo.
  const scope = isAdmin ? (executive ? (executive === "none" ? null : executive) : undefined) : user.id;
  const now = new Date();

  const [tasks, executives] = await Promise.all([
    listTasks(scope, now),
    isAdmin ? db.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }) : [],
  ]);
  const showAssignee = isAdmin && scope === undefined;
  const pendingCount = tasks.overdue.length + tasks.today.length + tasks.upcoming.length;

  const list = (items: TaskWithLead[]) => (
    <ul className="divide-y divide-slate-100 px-4">
      {items.map((t) => (
        <TaskItem
          key={t.id}
          task={t}
          now={now}
          lead={{ id: t.lead.id, name: t.lead.contact.name }}
          assigneeName={showAssignee ? (t.assignee?.name ?? null) : undefined}
        />
      ))}
    </ul>
  );

  return (
    <>
      <PageHeader
        title={isAdmin ? "Tareas" : "Mis tareas"}
        description="Lo que el equipo tiene que hacer con cada lead, por fecha de vencimiento. Las crea un ejecutivo desde la ficha del lead o la IA durante la conversación."
      >
        {isAdmin && (
          <form className="flex w-full items-center gap-2 sm:w-auto">
            <label htmlFor="executive" className="sr-only">
              Ejecutivo
            </label>
            <select id="executive" name="executive" defaultValue={executive ?? ""} className={`${inputClass} sm:w-56`}>
              <option value="">Todos los ejecutivos</option>
              <option value="none">Sin asignar</option>
              {executives.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            <button className={buttonClass("secondary")}>Filtrar</button>
          </form>
        )}
      </PageHeader>

      {pendingCount === 0 && tasks.done.length === 0 ? (
        <Card>
          <EmptyState icon={<ListTodo />} title="No hay tareas">
            Agrega una desde la ficha de un lead. La IA también crea tareas cuando el cliente necesita algo del equipo.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Group title="Vencidas" icon={<AlarmClock />} tone="bg-rose-50 text-rose-700" count={tasks.overdue.length} empty="Nada vencido.">
            {list(tasks.overdue)}
          </Group>
          <Group title="Hoy" icon={<CalendarClock />} tone="bg-amber-50 text-amber-800" count={tasks.today.length} empty="Nada más para hoy.">
            {list(tasks.today)}
          </Group>
          <Group title="Próximas" icon={<CalendarDays />} tone="bg-brand-50 text-brand-700" count={tasks.upcoming.length} empty="Sin tareas próximas.">
            {list(tasks.upcoming)}
          </Group>
          {tasks.done.length > 0 && (
            <details className="group lg:col-span-3">
              <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 text-sm font-semibold text-slate-700 hover:text-slate-900">
                <CircleCheck aria-hidden className="size-4 text-emerald-600" />
                Cumplidas en los últimos 7 días ({tasks.done.length})
              </summary>
              <Card className="mt-2">{list(tasks.done)}</Card>
            </details>
          )}
        </div>
      )}
    </>
  );
}

function Group({
  title,
  icon,
  tone,
  count,
  empty,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  tone: string;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="self-start">
      <h2 className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">
        <span className={`flex size-7 items-center justify-center rounded-lg [&_svg]:size-4 ${tone}`}>{icon}</span>
        {title}
        <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-700">{count}</span>
      </h2>
      {count > 0 ? children : <p className="px-4 py-6 text-center text-sm text-slate-500">{empty}</p>}
    </Card>
  );
}
