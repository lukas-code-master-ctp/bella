import Link from "next/link";
import { ArrowLeft, CircleCheck, Hourglass, Settings, Timer, UserRound } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { startOfLocalDay } from "@/lib/dates";
import { describeHours } from "@/lib/domain/ai-operation";
import { listFunnels } from "@/lib/domain/funnels";
import { formatDuration } from "@/lib/domain/metrics";
import { getSlaReport, getSlaSettings, type SlaStats } from "@/lib/domain/sla";
import { Badge, buttonClass, Card, CardHeader, EmptyState, FilterBar, inputClass, PageActions, PageHeader } from "@/components/ui";
import { AutoSubmitSelect } from "@/components/auto-submit-select";

const RANGES = [
  ["7", "Últimos 7 días"],
  ["30", "Últimos 30 días"],
  ["90", "Últimos 90 días"],
] as const;

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");
const int = (n: number) => n.toLocaleString("es-CL");

export default async function SlaPage({ searchParams }: { searchParams: Promise<{ d?: string; funnel?: string }> }) {
  const user = await requireUser();
  const params = await searchParams;
  const isAdmin = user.role === "ADMIN";
  const days = RANGES.some(([v]) => v === params.d) ? Number(params.d) : 30;
  const now = new Date();
  const funnels = await listFunnels();
  const funnelId = funnels.length > 1 ? funnels.find((f) => f.id === params.funnel)?.id : undefined;
  const s = await getSlaSettings();
  // El ejecutivo ve solo lo suyo; el admin, a todo el equipo.
  const report = await getSlaReport(
    { from: startOfLocalDay(now, -(days - 1)), to: now, assigneeId: isAdmin ? undefined : user.id, funnelId },
    s,
    now,
  );
  const overdue = report.waiting.filter((w) => w.elapsedMs > w.goalMs);

  return (
    <>
      <PageHeader
        title="SLA de ejecutivos"
        description={`${isAdmin ? "Cuánto tarda el equipo" : "Cuánto tardas"} en responder cuando el lead lo atiende una persona. Metas: primera respuesta en ${formatDuration(s.firstMinutes * 60_000)} y siguientes en ${formatDuration(s.replyMinutes * 60_000)}${s.hoursEnabled ? `, contando solo el horario laboral (${describeHours(s).toLowerCase()})` : ""}.`}
      >
        <PageActions>
          <Link href="/metrics" className={buttonClass("ghost")}>
            <ArrowLeft aria-hidden />
            Métricas
          </Link>
          {isAdmin && (
            <Link href="/settings/sla" className={buttonClass("secondary")}>
              <Settings aria-hidden />
              Metas y horario
            </Link>
          )}
        </PageActions>
      </PageHeader>

      <FilterBar>
        <label htmlFor="d" className="sr-only">
          Período
        </label>
        <AutoSubmitSelect id="d" name="d" defaultValue={String(days)} className={`${inputClass} sm:w-44`}>
          {RANGES.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </AutoSubmitSelect>
        {funnels.length > 1 && (
          <>
            <label htmlFor="funnel" className="sr-only">
              Embudo
            </label>
            <AutoSubmitSelect id="funnel" name="funnel" defaultValue={funnelId ?? ""} className={`${inputClass} sm:w-44`}>
              <option value="">Todos los embudos</option>
              {funnels.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </AutoSubmitSelect>
          </>
        )}
      </FilterBar>

      <div className="stagger space-y-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <Goal label="Primera respuesta" stats={report.first} />
          <Goal label="Siguientes respuestas" stats={report.reply} />
          <Card className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Esperando ahora</p>
            <p className={`mt-1 text-2xl font-bold tabular-nums tracking-tight ${overdue.length ? "text-rose-700" : "text-slate-900"}`}>
              {int(report.waiting.length)}
            </p>
            <p className="mt-0.5 text-xs text-slate-600">
              {overdue.length ? `${int(overdue.length)} pasaron la meta` : "Ninguno pasó la meta"}
            </p>
          </Card>
        </div>

        {isAdmin && report.byExecutive.length > 0 && (
          <Card className="overflow-hidden">
            <div className="p-5 pb-0">
              <CardHeader icon={<UserRound />} title="Por ejecutivo" description="Respuestas del período, en tiempo laboral. Cuenta para quien tenía el lead asignado." />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[50rem] text-sm">
                <thead>
                  <tr className="border-y border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    <th className="px-5 py-2.5">Ejecutivo</th>
                    <th className="px-3 py-2.5 text-right">1.ª en meta</th>
                    <th className="px-3 py-2.5 text-right">1.ª mediana</th>
                    <th className="px-3 py-2.5 text-right">Siguientes en meta</th>
                    <th className="px-3 py-2.5 text-right">Siguientes mediana</th>
                    <th className="px-3 py-2.5 text-right">Peor caso</th>
                    <th className="px-3 py-2.5 text-right" title="Leads que se le quitaron por no responder a tiempo">
                      Reasignados
                    </th>
                    <th className="px-5 py-2.5 text-right">Esperando</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.byExecutive.map((r) => (
                    <tr key={r.key}>
                      <td className="px-5 py-2.5 font-medium text-slate-900">{r.label}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                        <Compliance stats={r.first} />
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatDuration(r.first.medianMs)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                        <Compliance stats={r.reply} />
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatDuration(r.reply.medianMs)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {formatDuration(worst(r.first, r.reply))}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{r.reassigned ? int(r.reassigned) : "—"}</td>
                      <td className="whitespace-nowrap px-5 py-2.5 text-right tabular-nums">
                        {int(r.waiting)}
                        {r.overdue > 0 && (
                          <Badge tone="danger" className="ml-1.5">
                            {int(r.overdue)} {r.overdue === 1 ? "atrasado" : "atrasados"}
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <Card className="overflow-hidden">
          <div className="p-5 pb-0">
            <CardHeader icon={<Hourglass />} title="Esperando respuesta" description="Leads abiertos donde el cliente espera a una persona del equipo, los más atrasados primero." />
          </div>
          {report.waiting.length === 0 ? (
            <EmptyState icon={<CircleCheck />} title="Nadie esperando">
              Cuando un lead pase a un ejecutivo o el cliente le escriba, aparecerá aquí hasta que alguien le responda.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100 border-t border-slate-100 text-sm">
              {report.waiting.slice(0, 50).map((w) => {
                const late = w.elapsedMs > w.goalMs;
                return (
                  <li key={`${w.leadId}-${w.startedAt.getTime()}`}>
                    <Link href={`/leads/${w.leadId}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 hover:bg-slate-50">
                      <span className="min-w-0 flex-1 truncate font-medium text-slate-900">{w.contactName}</span>
                      <span className="text-slate-600">{w.assigneeName ?? "Sin asignar"}</span>
                      <span className="text-xs text-slate-500">{w.kind === "first" ? "Primera respuesta" : "Respuesta"}</span>
                      <Badge tone={late ? "danger" : "warning"}>
                        <Timer aria-hidden />
                        {formatDuration(w.elapsedMs)}
                        {late ? " · atrasado" : ` de ${formatDuration(w.goalMs)}`}
                      </Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

const worst = (...list: SlaStats[]) => list.reduce<number | null>((max, s) => (s.maxMs !== null && (max === null || s.maxMs > max) ? s.maxMs : max), null);

function Compliance({ stats }: { stats: SlaStats }) {
  if (!stats.count) return <span className="text-slate-400">—</span>;
  const ratio = stats.met / stats.count;
  return (
    <span className={ratio >= 0.9 ? "text-emerald-700" : ratio >= 0.7 ? "text-amber-700" : "text-rose-700"} title={`${stats.met} de ${stats.count}`}>
      {pct(stats.met, stats.count)}
      <span className="ml-1 text-xs text-slate-500">de {int(stats.count)}</span>
    </span>
  );
}

function Goal({ label, stats }: { label: string; stats: SlaStats }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-slate-900">{stats.count ? pct(stats.met, stats.count) : "—"}</p>
      <p className="mt-0.5 text-xs text-slate-600">
        {stats.count
          ? `dentro de la meta · ${int(stats.met)} de ${int(stats.count)} · mediana ${formatDuration(stats.medianMs)}`
          : "Sin respuestas en el período"}
      </p>
    </Card>
  );
}
