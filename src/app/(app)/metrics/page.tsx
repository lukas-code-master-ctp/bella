import Link from "next/link";
import { ChartNoAxesColumn, Clock, Megaphone, Sparkles, Trophy, UserRound } from "lucide-react";
import type { Channel } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { startOfLocalDay, toLocalInput } from "@/lib/dates";
import { campaignSpend } from "@/lib/channels/ads";
import { CHANNEL_LABEL } from "@/lib/labels";
import { hasUnseenInsight, markInsightSeen } from "@/lib/ai/weekly-insights";
import { listFunnels } from "@/lib/domain/funnels";
import { adReturns, formatDuration, getMetrics, type AdReturns, type Metrics, type ResponseStats, type Row } from "@/lib/domain/metrics";
import { buttonClass, Card, CardHeader, EmptyState, inputClass, PageHeader } from "@/components/ui";

const RANGES = [
  ["7", "Últimos 7 días"],
  ["30", "Últimos 30 días"],
  ["90", "Últimos 90 días"],
  ["365", "Último año"],
] as const;

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");
const money = (n: number) => `$${n.toLocaleString("es-CL")}`;
const int = (n: number) => n.toLocaleString("es-CL");
/** Cuántos pesos vendió cada peso invertido, ej. "×12,4". */
const roas = (amount: number, spend: number) => (spend ? `×${(amount / spend).toLocaleString("es-CL", { maximumFractionDigits: 1 })}` : "—");
const per = (spend: number, n: number) => (n ? money(Math.round(spend / n)) : "—");

export default async function MetricsPage({ searchParams }: { searchParams: Promise<{ d?: string; executive?: string; funnel?: string }> }) {
  const user = await requireUser();
  const params = await searchParams;
  const isAdmin = user.role === "ADMIN";
  const days = RANGES.some(([v]) => v === params.d) ? Number(params.d) : 30;
  // El ejecutivo ve solo sus leads; el admin, todos o los de un ejecutivo.
  const assigneeId = isAdmin ? params.executive || undefined : user.id;
  const now = new Date();
  // Con varios embudos, las métricas son de uno a la vez (las etapas de cada uno son distintas).
  const funnels = await listFunnels();
  const funnelId = funnels.length > 1 ? (funnels.find((f) => f.id === params.funnel) ?? funnels[0]).id : undefined;
  const from = startOfLocalDay(now, -(days - 1));
  // El gasto es de la empresa entera: se cruza solo cuando el admin mira a todo el equipo.
  const withSpend = isAdmin && !assigneeId;
  const [m, executives, newInsight, spends] = await Promise.all([
    getMetrics({ from, to: now, assigneeId, funnelId }),
    isAdmin ? db.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }) : [],
    isAdmin && hasUnseenInsight(user.id),
    withSpend ? campaignSpend(toLocalInput(from).slice(0, 10), toLocalInput(now).slice(0, 10)) : null,
  ]);
  const ads = spends ? adReturns(m.byCampaign, spends) : null;
  // Entrar a Métricas apaga el "Nuevo" del menú; el botón del resumen lo sigue mostrando en esta visita.
  if (newInsight) await markInsightSeen(user.id);
  const t = m.totals;
  const closed = t.won + t.lost;

  return (
    <>
      <PageHeader
        title="Métricas"
        description={
          isAdmin
            ? "Cómo va el embudo y el equipo, sobre los leads que entraron en el período (sin el simulador)."
            : "Cómo van tus leads, sobre los que entraron en el período."
        }
      >
        {isAdmin && (
          <Link href="/metrics/insights" className={buttonClass("secondary")}>
            <Sparkles aria-hidden />
            Resumen semanal
            {newInsight && <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">Nuevo</span>}
          </Link>
        )}
        <form className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <label htmlFor="d" className="sr-only">
            Período
          </label>
          <select id="d" name="d" defaultValue={String(days)} className={`${inputClass} sm:w-44`}>
            {RANGES.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          {funnelId && (
            <>
              <label htmlFor="funnel" className="sr-only">
                Embudo
              </label>
              <select id="funnel" name="funnel" defaultValue={funnelId} className={`${inputClass} sm:w-44`}>
                {funnels.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </>
          )}
          {isAdmin && (
            <>
              <label htmlFor="executive" className="sr-only">
                Ejecutivo
              </label>
              <select id="executive" name="executive" defaultValue={assigneeId ?? ""} className={`${inputClass} sm:w-48`}>
                <option value="">Todo el equipo</option>
                {executives.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </>
          )}
          <button className={buttonClass("secondary")}>Ver</button>
        </form>
      </PageHeader>

      {t.leads === 0 ? (
        <Card>
          <EmptyState icon={<ChartNoAxesColumn />} title="Sin leads en este período">
            Cuando lleguen leads por WhatsApp, Instagram o Messenger, aquí verás de dónde vienen y cómo avanzan.
          </EmptyState>
        </Card>
      ) : (
        <div className="stagger space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Leads nuevos" value={int(t.leads)} hint={`${int(t.open)} siguen abiertos`} />
            <Stat label="Ganados" value={int(t.won)} hint={`${pct(t.won, t.leads)} de los leads`} />
            <Stat label="Tasa de cierre" value={pct(t.won, closed)} hint={`${int(t.won)} ganados de ${int(closed)} cerrados`} />
            <Stat label="Ventas" value={money(t.amount)} hint={t.won ? `${money(Math.round(t.amount / t.won))} por venta` : "Sin ventas aún"} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="p-5">
              <CardHeader title="Por canal" description="Leads nuevos y cuántos se ganaron." />
              <Bars rows={m.byChannel.map((r) => ({ ...r, label: CHANNEL_LABEL[r.key as Channel] ?? r.label }))} />
            </Card>
            <Card className="p-5">
              <CardHeader
                title="Por campaña"
                description={
                  withSpend && !ads ? (
                    <>
                      Campaña del anuncio de Meta o utm_campaign de la landing. Para ver cuánto costó y cuánto vendió cada una, carga el
                      token de anuncios en{" "}
                      <Link href="/settings/credentials" className="font-medium text-brand-700 underline">
                        Credenciales
                      </Link>
                      .
                    </>
                  ) : (
                    "Campaña del anuncio de Meta o utm_campaign de la landing."
                  )
                }
              />
              <Bars rows={m.byCampaign.slice(0, 12)} more={m.byCampaign.length - 12} />
            </Card>
          </div>

          {ads && <AdReturnsCard ads={ads} multiFunnel={!!funnelId} />}

          <Card className="p-5">
            <CardHeader
              title="Embudo"
              description="Cuántos leads llegaron a cada etapa (o pasaron por ella) y qué parte avanzó desde la anterior."
            />
            <ol className="space-y-2.5">
              {m.funnel.map((s, i) => {
                const prev = i > 0 ? m.funnel[i - 1].reached : null;
                return (
                  <li key={s.stageId} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto]">
                    <span className="truncate font-medium text-slate-800" title={s.name}>
                      {s.name}
                    </span>
                    <Bar value={s.reached} max={t.leads} label={`${s.name}: ${int(s.reached)} leads llegaron, ${int(s.current)} están ahí ahora`} />
                    <span className="w-28 text-right tabular-nums text-slate-900">
                      {int(s.reached)}
                      <span className="ml-1.5 text-xs text-slate-500">{prev === null ? "" : pct(s.reached, prev)}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </Card>

          {m.byCampaign.length > 1 && m.funnel.length > 1 && <CampaignFunnelCard m={m} />}

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="p-5">
              <CardHeader icon={<Clock />} title="Tiempo de respuesta" description="Desde el primer mensaje del cliente." />
              <dl className="grid gap-4 sm:grid-cols-2">
                <Response label="Primera respuesta (IA o equipo)" stats={m.firstReply} />
                <Response label="Primera respuesta del equipo" stats={m.firstHumanReply} />
              </dl>
            </Card>
            <Card className="p-5">
              <CardHeader icon={<Trophy />} title="Ganados y perdidos" description={`${int(t.won)} ganados · ${int(t.lost)} perdidos`} />
              {m.lostReasons.length ? (
                <>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Motivos de pérdida</p>
                  <ul className="space-y-2 text-sm">
                    {m.lostReasons.slice(0, 8).map((r) => (
                      <li key={r.reason} className="grid grid-cols-[minmax(0,1fr)_minmax(0,40%)_2.5rem] items-center gap-3">
                        <span className="truncate text-slate-800" title={r.reason}>
                          {r.reason}
                        </span>
                        <Bar value={r.count} max={m.lostReasons[0].count} tone="muted" label={`${r.reason}: ${r.count}`} />
                        <span className="text-right tabular-nums text-slate-900">{int(r.count)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-sm text-slate-500">Sin leads perdidos en el período.</p>
              )}
            </Card>
          </div>

          {isAdmin && !assigneeId && (
            <Card className="overflow-hidden">
              <div className="p-5 pb-0">
                <CardHeader icon={<UserRound />} title="Por ejecutivo" description="Leads asignados que entraron en el período." />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] text-sm">
                  <thead>
                    <tr className="border-y border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                      <th className="px-5 py-2.5">Ejecutivo</th>
                      <th className="px-3 py-2.5 text-right">Leads</th>
                      <th className="px-3 py-2.5 text-right">Ganados</th>
                      <th className="px-3 py-2.5 text-right">Perdidos</th>
                      <th className="px-3 py-2.5 text-right">Cierre</th>
                      <th className="px-3 py-2.5 text-right">Ventas</th>
                      <th className="px-5 py-2.5 text-right">1.ª respuesta</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {m.byExecutive.map((r) => (
                      <tr key={r.key}>
                        <td className="px-5 py-2.5 font-medium text-slate-900">{r.label}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{int(r.leads)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{int(r.won)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{int(r.lost)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{pct(r.won, r.won + r.lost)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{money(r.amount)}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums" title="Mediana desde el primer mensaje del cliente">
                          {formatDuration(r.firstReplyMs)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}
    </>
  );
}

function AdReturnsCard({ ads, multiFunnel }: { ads: AdReturns; multiFunnel: boolean }) {
  const rows = ads.rows.filter((r) => r.spend !== null);
  return (
    <Card className="overflow-hidden">
      <div className="p-5 pb-4">
        <CardHeader
          icon={<Megaphone />}
          title="Inversión y retorno"
          description={`Gasto de Meta en el período cruzado con los leads que trajo cada campaña y lo que se les vendió.${
            multiFunnel ? " El gasto es de la campaña completa, aunque sus leads estén en otro embudo." : ""
          }`}
        />
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <Figure label="Invertido" value={money(ads.spend)} />
          <Figure label="Costo por lead" value={per(ads.spend, ads.leads)} hint={`${int(ads.leads)} leads de anuncios`} />
          <Figure label="Costo por venta" value={per(ads.spend, ads.won)} hint={`${int(ads.won)} ventas`} />
          <Figure label="Retorno" value={roas(ads.amount, ads.spend)} hint={`${money(ads.amount)} vendidos`} />
        </dl>
      </div>
      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="border-y border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                <th className="px-5 py-2.5">Campaña</th>
                <th className="px-3 py-2.5 text-right">Invertido</th>
                <th className="px-3 py-2.5 text-right">Leads</th>
                <th className="px-3 py-2.5 text-right">Costo por lead</th>
                <th className="px-3 py-2.5 text-right">Ventas</th>
                <th className="px-3 py-2.5 text-right">Costo por venta</th>
                <th className="px-3 py-2.5 text-right">Vendido</th>
                <th className="px-5 py-2.5 text-right" title="Pesos vendidos por cada peso invertido">
                  Retorno
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="max-w-[16rem] truncate px-5 py-2.5 font-medium text-slate-900" title={r.label}>
                    {r.label}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{money(r.spend ?? 0)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{int(r.leads)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{per(r.spend ?? 0, r.leads)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{int(r.won)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{per(r.spend ?? 0, r.won)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{money(r.amount)}</td>
                  <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-slate-900">{roas(r.amount, r.spend ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-5 pb-5 text-sm text-slate-500">Meta no registra gasto en este período.</p>
      )}
    </Card>
  );
}

function CampaignFunnelCard({ m }: { m: Metrics }) {
  const stages = m.funnel.slice(1);
  const rows = m.byCampaign.slice(0, 10);
  return (
    <Card className="overflow-hidden">
      <div className="p-5 pb-4">
        <CardHeader
          title="Embudo por campaña"
          description="Hasta dónde llegan los leads de cada campaña: cuáles traen curiosos y cuáles traen compradores."
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: `${16 + 6 * (stages.length + 1)}rem` }}>
          <thead>
            <tr className="border-y border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
              <th className="px-5 py-2.5">Campaña</th>
              <th className="px-3 py-2.5 text-right">Leads</th>
              {stages.map((s) => (
                <th key={s.stageId} className="max-w-[8rem] truncate px-3 py-2.5 text-right" title={s.name}>
                  {s.name}
                </th>
              ))}
              <th className="px-5 py-2.5 text-right">Ganados</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const reach = m.campaignReach[r.key] ?? [];
              return (
                <tr key={r.key}>
                  <td className="max-w-[16rem] truncate px-5 py-2.5 font-medium text-slate-900" title={r.label}>
                    {r.label}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{int(r.leads)}</td>
                  {stages.map((s, i) => {
                    const n = reach[i + 1] ?? 0;
                    return (
                      <td key={s.stageId} className="px-3 py-2.5 text-right tabular-nums">
                        {int(n)}
                        <span className="ml-1.5 text-xs text-slate-500">{pct(n, r.leads)}</span>
                      </td>
                    );
                  })}
                  <td className="px-5 py-2.5 text-right tabular-nums">
                    {int(r.won)}
                    <span className="ml-1.5 text-xs text-slate-500">{pct(r.won, r.leads)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {m.byCampaign.length > rows.length && (
        <p className="px-5 py-3 text-xs text-slate-500">Y {m.byCampaign.length - rows.length} campañas más con menos leads.</p>
      )}
    </Card>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</dt>
      <dd className="mt-0.5 text-xl font-bold tabular-nums tracking-tight text-slate-900">{value}</dd>
      {hint && <dd className="text-xs text-slate-600">{hint}</dd>}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-slate-900">{value}</p>
      <p className="mt-0.5 text-xs text-slate-600">{hint}</p>
    </Card>
  );
}

function Bar({ value, max, label, tone = "brand" }: { value: number; max: number; label: string; tone?: "brand" | "muted" }) {
  return (
    <span className="block h-2.5 rounded-full bg-slate-100" role="img" aria-label={label} title={label}>
      <span
        className={`block h-full rounded-full ${tone === "brand" ? "bg-brand-500" : "bg-slate-400"}`}
        style={{ width: `${max ? Math.max(2, (value / max) * 100) : 0}%` }}
      />
    </span>
  );
}

function Bars({ rows, more = 0 }: { rows: Row[]; more?: number }) {
  const max = Math.max(...rows.map((r) => r.leads), 1);
  return (
    <>
      <ul className="space-y-3 text-sm">
        {rows.map((r) => (
          <li key={r.key} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate font-medium text-slate-800" title={r.label}>
                {r.label}
              </span>
              <span className="shrink-0 tabular-nums text-slate-900">
                {int(r.leads)}
                <span className="ml-1.5 text-xs text-slate-500">
                  {int(r.won)} ganados{r.amount ? ` · ${money(r.amount)}` : ""}
                </span>
              </span>
            </div>
            <Bar value={r.leads} max={max} label={`${r.label}: ${r.leads} leads, ${r.won} ganados`} />
          </li>
        ))}
      </ul>
      {more > 0 && <p className="mt-3 text-xs text-slate-500">Y {more} campañas más con menos leads.</p>}
    </>
  );
}

function Response({ label, stats }: { label: string; stats: ResponseStats }) {
  return (
    <div>
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd className="mt-1">
        <span className="text-2xl font-bold tabular-nums tracking-tight text-slate-900">{formatDuration(stats.medianMs)}</span>
        <span className="ml-1.5 text-xs text-slate-600">mediana</span>
        <p className="mt-0.5 text-xs text-slate-600">
          {stats.count
            ? `9 de cada 10 en ${formatDuration(stats.p90Ms)} o menos · ${pct(stats.within5m, stats.count)} en 5 min`
            : "Sin respuestas en el período"}
        </p>
      </dd>
    </div>
  );
}
