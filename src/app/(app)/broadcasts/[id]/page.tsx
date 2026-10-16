import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CircleX, Pause, Play } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { credential } from "@/lib/credentials";
import {
  broadcastRecipients,
  broadcastStats,
  EMPTY_STATS,
  RECIPIENT_FILTERS,
  type RecipientFilter,
  type RecipientState,
} from "@/lib/domain/broadcasts";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { Callout, Stat } from "@/components/settings-ui";
import { SubmitButton } from "@/components/submit-button";
import { cancelBroadcastAction, pauseBroadcastAction, resumeBroadcastAction } from "../actions";
import { BroadcastStatusBadge, dateTime, pct } from "../ui";

const STATE: Record<RecipientState, { label: string; tone: "brand" | "success" | "warning" | "danger" | "neutral" }> = {
  PENDING: { label: "Por enviar", tone: "neutral" },
  SENT: { label: "Enviado", tone: "neutral" },
  DELIVERED: { label: "Entregado", tone: "neutral" },
  READ: { label: "Leído", tone: "brand" },
  REPLIED: { label: "Respondió", tone: "success" },
  FAILED: { label: "Falló", tone: "danger" },
  SKIPPED: { label: "No se envió", tone: "warning" },
};

const FILTER_LABEL: Record<RecipientFilter, string> = {
  todos: "Todos",
  respondieron: "Respondieron",
  leidos: "Leyeron",
  sin_leer: "Sin leer",
  fallaron: "Fallaron",
  pendientes: "Por enviar",
};

export default async function BroadcastPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ filtro?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const { filtro } = await searchParams;
  const filter = (filtro && filtro in RECIPIENT_FILTERS ? filtro : "todos") as RecipientFilter;
  const b = await db.broadcast.findUnique({ where: { id } });
  if (!b) notFound();

  const [statsMap, recipients, stage, creator, number, mainNumber] = await Promise.all([
    broadcastStats([b.id]),
    broadcastRecipients(b.id, filter),
    db.stage.findUnique({ where: { id: b.stageId }, include: { funnel: true } }),
    b.createdById ? db.user.findUnique({ where: { id: b.createdById }, select: { name: true } }) : null,
    b.fromPhoneNumberId ? db.whatsAppNumber.findUnique({ where: { phoneNumberId: b.fromPhoneNumberId } }) : null,
    credential("WHATSAPP_PHONE_NUMBER_ID"),
  ]);
  const s = statsMap.get(b.id) ?? EMPTY_STATS;
  const fromLabel = number ? `${number.label}${number.displayPhone ? ` (${number.displayPhone})` : ""}` : mainNumber ? "el número principal" : null;

  return (
    <>
      {b.status === "SENDING" && <AutoRefresh seconds={10} />}
      <Link href="/broadcasts" className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900">
        <ArrowLeft aria-hidden className="size-4" />
        Envíos masivos
      </Link>
      <PageHeader
        title={b.name}
        description={
          <>
            Plantilla <span className="font-medium text-slate-800">{b.templateName}</span>
            {fromLabel && ` · desde ${fromLabel}`} · los leads nuevos quedan en{" "}
            <span className="font-medium text-slate-800">{stage ? `${stage.funnel.name} · ${stage.name}` : "la primera etapa"}</span> · máximo{" "}
            {b.dailyLimit.toLocaleString("es-CL")} por día · creado {dateTime(b.createdAt)}
            {creator ? ` por ${creator.name}` : ""}
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <BroadcastStatusBadge status={b.status} stats={s} />
          {b.status === "SENDING" && (
            <form action={pauseBroadcastAction.bind(null, b.id)}>
              <SubmitButton variant="secondary" pendingText="Pausando…">
                <Pause aria-hidden />
                Pausar
              </SubmitButton>
            </form>
          )}
          {b.status === "PAUSED" && (
            <form action={resumeBroadcastAction.bind(null, b.id)}>
              <SubmitButton pendingText="Reanudando…">
                <Play aria-hidden />
                Seguir enviando
              </SubmitButton>
            </form>
          )}
          {(b.status === "SENDING" || b.status === "PAUSED") && (
            <form action={cancelBroadcastAction.bind(null, b.id)}>
              <SubmitButton variant="ghost-danger" pendingText="Cancelando…" confirm="¿Cancelar el envío? A quienes faltan ya no les llegará.">
                <CircleX aria-hidden />
                Cancelar
              </SubmitButton>
            </form>
          )}
        </div>
      </PageHeader>

      <div className="space-y-6">
        {b.status === "PAUSED" && b.note && (
          <Callout tone="danger" title="El envío se pausó solo">
            {b.note} Cuando lo corrijas, toca “Seguir enviando”.
          </Callout>
        )}
        {b.status === "SENDING" && s.pending > 0 && (
          <Callout tone="neutral">
            Sale por tandas cada pocos minutos, hasta {b.dailyLimit.toLocaleString("es-CL")} personas por día. Faltan{" "}
            {s.pending.toLocaleString("es-CL")}.
          </Callout>
        )}

        <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="Enviados" value={s.sent.toLocaleString("es-CL")} hint={`de ${s.total.toLocaleString("es-CL")} personas`} />
          <Stat label="Entregados" value={s.delivered.toLocaleString("es-CL")} hint={pct(s.delivered, s.sent)} />
          <Stat label="Leídos" value={s.read.toLocaleString("es-CL")} hint={pct(s.read, s.sent)} />
          <Stat label="Respondieron" value={s.replied.toLocaleString("es-CL")} hint={pct(s.replied, s.sent)} />
          <Stat
            label="Fallaron"
            value={(s.failed + s.skipped).toLocaleString("es-CL")}
            hint={s.skipped ? `${s.skipped.toLocaleString("es-CL")} no se enviaron` : pct(s.failed, s.total)}
          />
        </div>

        <Card className="animate-rise overflow-hidden">
          <nav aria-label="Filtrar personas" className="flex flex-wrap gap-1.5 border-b border-slate-100 p-3">
            {(Object.keys(FILTER_LABEL) as RecipientFilter[]).map((f) => (
              <Link
                key={f}
                href={f === "todos" ? `/broadcasts/${b.id}` : `/broadcasts/${b.id}?filtro=${f}`}
                aria-current={f === filter ? "page" : undefined}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors duration-150 ${
                  f === filter ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {FILTER_LABEL[f]}
              </Link>
            ))}
          </nav>
          {recipients.length === 0 ? (
            <EmptyState icon={<CircleX />} title="Nadie en este filtro" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-4 py-2.5">Persona</th>
                    <th className="px-4 py-2.5">WhatsApp</th>
                    <th className="px-4 py-2.5">Estado</th>
                    <th className="px-4 py-2.5">Etapa ahora</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recipients.map((r) => (
                    <tr key={r.id}>
                      <td className="px-4 py-2.5 font-medium text-slate-900">
                        {r.leadId ? (
                          <Link href={`/leads/${r.leadId}`} className="hover:text-brand-700 hover:underline">
                            {r.name}
                          </Link>
                        ) : (
                          r.name
                        )}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-slate-600">+{r.phone}</td>
                      <td className="px-4 py-2.5">
                        <Badge tone={STATE[r.state].tone}>{STATE[r.state].label}</Badge>
                        {r.error && (r.state === "FAILED" || r.state === "SKIPPED") && <p className="mt-1 max-w-xs text-xs text-slate-600">{r.error}</p>}
                      </td>
                      <td className="px-4 py-2.5 text-slate-700">
                        {r.stageName ?? "–"}
                        {r.leadStatus === "WON" && " · ganado"}
                        {r.leadStatus === "LOST" && " · perdido"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {recipients.length === 200 && <p className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-600">Se muestran las primeras 200 personas.</p>}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
