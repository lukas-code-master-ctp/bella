import Link from "next/link";
import { ArrowLeft, CircleCheck, PhoneMissed, Settings, UserRound } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { startOfLocalDay } from "@/lib/dates";
import { formatChileDateTime } from "@/lib/domain/follow-ups";
import { formatCallDuration, getCallReport } from "@/lib/domain/call-metrics";
import { Badge, buttonClass, Card, CardHeader, ClearFilters, EmptyState, FilterBar, inputClass, PageActions, PageHeader } from "@/components/ui";
import { AutoSubmitSelect } from "@/components/auto-submit-select";

const RANGES = [
  ["7", "Últimos 7 días"],
  ["30", "Últimos 30 días"],
  ["90", "Últimos 90 días"],
] as const;

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");
const int = (n: number) => n.toLocaleString("es-CL");

export default async function CallsMetricsPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const user = await requireUser();
  const params = await searchParams;
  const isAdmin = user.role === "ADMIN";
  const days = RANGES.some(([v]) => v === params.d) ? Number(params.d) : 30;
  const now = new Date();
  // El ejecutivo ve las llamadas que atendió o hizo y las de sus leads; el admin, todas.
  const r = await getCallReport({ from: startOfLocalDay(now, -(days - 1)), to: now, userId: isAdmin ? undefined : user.id });

  return (
    <>
      <PageHeader
        title={isAdmin ? "Llamadas" : "Mis llamadas"}
        description="Llamadas de WhatsApp del período: las que hacen los clientes y las que hace el equipo desde el chat."
      >
        <PageActions>
          <Link href="/metrics" className={buttonClass("ghost")}>
            <ArrowLeft aria-hidden />
            Métricas
          </Link>
          {isAdmin && (
            <Link href="/settings/channels/whatsapp" className={buttonClass("secondary")}>
              <Settings aria-hidden />
              Configurar llamadas
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
        {days !== 30 && <ClearFilters href="/metrics/calls" />}
      </FilterBar>

      <div className="stagger space-y-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Recibidas" value={int(r.inbound)} hint={`${pct(r.inboundAnswered, r.inbound)} atendidas`} />
          <Stat
            label="Perdidas"
            value={int(r.inboundMissed)}
            hint={r.inboundMissed ? `${pct(r.inboundMissed, r.inbound)} de las recibidas` : "Ninguna"}
            danger={r.inboundMissed > 0}
          />
          <Stat label="Hechas por el equipo" value={int(r.outbound)} hint={`${int(r.outboundConnected)} contestadas, ${int(r.outboundUnanswered)} sin respuesta`} />
          <Stat
            label="Duración promedio"
            value={formatCallDuration(r.avgSec)}
            hint={`${formatCallDuration(r.totalSec)} en total${r.recorded ? ` · ${int(r.recorded)} grabadas` : ""}`}
          />
        </div>

        {r.byUser.length > 0 && (
          <Card className="overflow-hidden">
            <div className="p-5 pb-0">
              <CardHeader icon={<UserRound />} title="Por ejecutivo" description="Cuenta para quien atendió o hizo la llamada." />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead>
                  <tr className="border-y border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    <th className="px-5 py-2.5">Ejecutivo</th>
                    <th className="px-3 py-2.5 text-right">Atendidas</th>
                    <th className="px-3 py-2.5 text-right">Hechas</th>
                    <th className="px-3 py-2.5 text-right">Contestadas</th>
                    <th className="px-3 py-2.5 text-right">Tiempo total</th>
                    <th className="px-5 py-2.5 text-right">Promedio</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {r.byUser.map((u) => {
                    const talks = u.answered + u.connected;
                    return (
                      <tr key={u.userId}>
                        <td className="px-5 py-2.5 font-medium text-slate-900">{u.name}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{int(u.answered)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{int(u.made)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                          {int(u.connected)}
                          {u.made > 0 && <span className="ml-1 text-xs text-slate-500">{pct(u.connected, u.made)}</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{formatCallDuration(u.totalSec)}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums">{formatCallDuration(talks ? Math.round(u.totalSec / talks) : null)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <Card className="overflow-hidden">
          <div className="p-5 pb-0">
            <CardHeader
              icon={<PhoneMissed />}
              title="Perdidas recientes"
              description="Clientes que llamaron y nadie atendió. Queda marcada como devuelta si después se habló con el cliente por teléfono."
            />
          </div>
          {r.recentMissed.length === 0 ? (
            <EmptyState icon={<CircleCheck />} title="Sin llamadas perdidas">
              Cuando un cliente llame y nadie conteste, aparecerá aquí para devolverle la llamada.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100 border-t border-slate-100 text-sm">
              {r.recentMissed.map((m) => (
                <li key={m.id}>
                  <Link href={`/leads/${m.leadId}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 hover:bg-slate-50">
                    <span className="min-w-0 flex-1 truncate font-medium text-slate-900">{m.name}</span>
                    <span className="text-slate-600">{formatChileDateTime(m.at)}</span>
                    {m.calledBack ? <Badge tone="success">Devuelta</Badge> : <Badge tone="danger">Sin devolver</Badge>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function Stat({ label, value, hint, danger = false }: { label: string; value: string; hint: string; danger?: boolean }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums tracking-tight ${danger ? "text-rose-700" : "text-slate-900"}`}>{value}</p>
      <p className="mt-0.5 text-xs text-slate-600">{hint}</p>
    </Card>
  );
}
