import Link from "next/link";
import { Bot, ChevronLeft, ChevronRight } from "lucide-react";
import { localMonthName, localWeekdayHour, startOfLocalDay, toLocalInput } from "@/lib/dates";
import { bucketOf, type TaskWithLead } from "@/lib/domain/tasks";
import { buttonClass, Card } from "@/components/ui";

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

const TONE = {
  overdue: "bg-rose-50 text-rose-800 hover:bg-rose-100",
  today: "bg-amber-50 text-amber-900 hover:bg-amber-100",
  upcoming: "bg-brand-50 text-brand-800 hover:bg-brand-100",
  done: "bg-slate-50 text-slate-500 line-through hover:bg-slate-100",
};

/**
 * Calendario mensual de tareas (lunes a domingo, en hora de Chile). Cada tarea lleva a su lead.
 * En móvil se muestra como agenda: solo los días con tareas.
 */
export function TaskCalendar({
  tasks,
  monthStart,
  nextMonth,
  now,
  monthHref,
  showAssignee,
}: {
  tasks: TaskWithLead[];
  monthStart: Date;
  nextMonth: Date;
  now: Date;
  monthHref: (offset: -1 | 0 | 1) => string;
  showAssignee: boolean;
}) {
  const byDay = new Map<string, TaskWithLead[]>();
  for (const t of tasks) {
    const key = toLocalInput(t.dueAt).slice(0, 10);
    byDay.set(key, [...(byDay.get(key) ?? []), t]);
  }
  const days: { key: string; day: number; weekday: number }[] = [];
  for (let d = monthStart; d < nextMonth; d = startOfLocalDay(d, 1)) {
    days.push({ key: toLocalInput(d).slice(0, 10), day: days.length + 1, weekday: localWeekdayHour(d).weekday });
  }
  const todayKey = toLocalInput(now).slice(0, 10);
  const leading = (days[0].weekday + 6) % 7;
  const year = toLocalInput(monthStart).slice(0, 4);

  const chip = (t: TaskWithLead) => {
    const tone = t.completedAt ? "done" : bucketOf(t.dueAt, now);
    const hour = toLocalInput(t.dueAt).slice(11);
    return (
      <Link
        key={t.id}
        href={`/leads/${t.lead.id}`}
        title={`${hour} · ${t.title} · ${t.lead.contact.name}${showAssignee ? ` · ${t.assignee?.name ?? "Sin asignar"}` : ""}`}
        className={`flex items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-xs transition-colors duration-150 ${TONE[tone]}`}
      >
        <span className="shrink-0 font-semibold tabular-nums">{hour}</span>
        <span className="truncate">{t.title}</span>
        {t.createdBy === "AI" && <Bot aria-label="Creada por la IA" className="size-3 shrink-0" />}
      </Link>
    );
  };

  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">
          {localMonthName(monthStart)} {year}
        </h2>
        <div className="ml-auto flex items-center gap-1">
          <Link href={monthHref(0)} className={buttonClass("secondary", "sm")}>
            Hoy
          </Link>
          <Link href={monthHref(-1)} aria-label="Mes anterior" className={buttonClass("ghost", "icon")}>
            <ChevronLeft aria-hidden />
          </Link>
          <Link href={monthHref(1)} aria-label="Mes siguiente" className={buttonClass("ghost", "icon")}>
            <ChevronRight aria-hidden />
          </Link>
        </div>
      </div>

      {/* Escritorio: grilla del mes */}
      <div className="hidden md:block">
        <div className="grid grid-cols-7 border-b border-slate-100 text-center text-xs font-medium text-slate-500">
          {WEEKDAYS.map((w) => (
            <div key={w} className="py-2">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: leading }, (_, i) => (
            <div key={`pad-${i}`} className="min-h-28 border-b border-r border-slate-100 bg-slate-50/50" />
          ))}
          {days.map(({ key, day }) => {
            const items = byDay.get(key) ?? [];
            const isToday = key === todayKey;
            return (
              <div key={key} className="min-h-28 min-w-0 space-y-1 border-b border-r border-slate-100 p-1.5">
                <span
                  className={`flex size-6 items-center justify-center rounded-full text-xs tabular-nums ${
                    isToday ? "bg-brand-600 font-semibold text-white" : "text-slate-600"
                  }`}
                >
                  {day}
                </span>
                {items.map(chip)}
              </div>
            );
          })}
        </div>
      </div>

      {/* Móvil: agenda con los días que tienen tareas */}
      <div className="md:hidden">
        {tasks.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-500">No hay tareas este mes.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {days
              .filter((d) => byDay.has(d.key))
              .map(({ key, day, weekday }) => (
                <li key={key} className="flex gap-3 px-4 py-3">
                  <div className={`w-10 shrink-0 text-center ${key === todayKey ? "text-brand-700" : "text-slate-600"}`}>
                    <p className="text-xs">{WEEKDAYS[(weekday + 6) % 7]}</p>
                    <p className="text-lg font-semibold tabular-nums">{day}</p>
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">{byDay.get(key)!.map(chip)}</div>
                </li>
              ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
