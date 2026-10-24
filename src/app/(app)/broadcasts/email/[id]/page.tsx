import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CircleX, Pause, Play, Repeat, Send, Trophy } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  AB_MIN_DELIVERED,
  emailAbResults,
  emailNonOpenersCount,
  EMAIL_RECIPIENT_FILTERS,
  emailBroadcastRecipients,
  emailBroadcastStats,
  EMPTY_EMAIL_STATS,
  type EmailRecipientFilter,
} from "@/lib/domain/email-broadcasts";
import type { EmailRecipient } from "@prisma/client";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge, buttonClass, Card, EmptyState, PageHeader } from "@/components/ui";
import { Callout, Stat } from "@/components/settings-ui";
import { SubmitButton } from "@/components/submit-button";
import { cancelEmailBroadcastAction, pauseEmailBroadcastAction, resumeEmailBroadcastAction, sendEmailBroadcastNowAction } from "../actions";
import { BroadcastStatusBadge, dateTime, pct } from "../../ui";

function state(r: EmailRecipient): { label: string; tone: "brand" | "success" | "warning" | "danger" | "neutral" } {
  if (r.complainedAt) return { label: "Marcó spam", tone: "danger" };
  if (r.bouncedAt) return { label: "Rebotó", tone: "danger" };
  if (r.clickedAt) return { label: "Hizo clic", tone: "success" };
  if (r.openedAt) return { label: "Abrió", tone: "brand" };
  if (r.deliveredAt) return { label: "Entregado", tone: "neutral" };
  if (r.status === "SENT") return { label: "Enviado", tone: "neutral" };
  if (r.status === "FAILED") return { label: "Falló", tone: "danger" };
  if (r.status === "SKIPPED") return { label: "No se envió", tone: "warning" };
  return { label: "Por enviar", tone: "neutral" };
}

export default async function EmailBroadcastPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ filtro?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const { filtro } = await searchParams;
  const filter = (filtro && filtro in EMAIL_RECIPIENT_FILTERS ? filtro : "todos") as EmailRecipientFilter;
  const b = await db.emailBroadcast.findUnique({ where: { id } });
  if (!b) notFound();
  const finished = b.status === "DONE" || b.status === "CANCELED";
  const [statsMap, recipients, creator, ab, nonOpeners, original] = await Promise.all([
    emailBroadcastStats([b.id]),
    emailBroadcastRecipients(b.id, filter),
    b.createdById ? db.user.findUnique({ where: { id: b.createdById }, select: { name: true } }) : null,
    emailAbResults(b),
    finished ? emailNonOpenersCount(b.id) : 0,
    b.resentFromId ? db.emailBroadcast.findUnique({ where: { id: b.resentFromId }, select: { id: true, name: true } }) : null,
  ]);
  const s = statsMap.get(b.id) ?? EMPTY_EMAIL_STATS;

  return (
    <>
      {b.status === "SENDING" && <AutoRefresh seconds={10} />}
      <Link href="/broadcasts?canal=correo" className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900">
        <ArrowLeft aria-hidden className="size-4" />
        Envíos masivos
      </Link>
      <PageHeader
        title={b.name}
        description={
          <>
            Correo <span className="font-medium text-slate-800">«{b.subject}»</span>
            {b.subjectB && (
              <>
                {" "}y <span className="font-medium text-slate-800">«{b.subjectB}»</span> (prueba A/B)
              </>
            )}
            {original && (
              <>
                {" "}· reenvío de{" "}
                <Link href={`/broadcasts/email/${original.id}`} className="font-medium text-brand-700 underline-offset-2 hover:underline">
                  {original.name}
                </Link>
              </>
            )}{" "}
            · máximo {b.dailyLimit.toLocaleString("es-CL")} por día · creado{" "}
            {dateTime(b.createdAt)}
            {creator ? ` por ${creator.name}` : ""}
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <BroadcastStatusBadge status={b.status} stats={s} />
          {b.status === "SCHEDULED" && (
            <form action={sendEmailBroadcastNowAction.bind(null, b.id)}>
              <SubmitButton variant="secondary" pendingText="Enviando…" confirm="¿Enviarlo ahora, sin esperar la hora programada?">
                <Send aria-hidden />
                Enviar ahora
              </SubmitButton>
            </form>
          )}
          {finished && nonOpeners > 0 && (
            <Link href={`/broadcasts/email/new?reenviar=${b.id}`} className={buttonClass("secondary", "md")}>
              <Repeat aria-hidden />
              Reenviar a quienes no abrieron ({nonOpeners.toLocaleString("es-CL")})
            </Link>
          )}
          {b.status === "SENDING" && (
            <form action={pauseEmailBroadcastAction.bind(null, b.id)}>
              <SubmitButton variant="secondary" pendingText="Pausando…">
                <Pause aria-hidden />
                Pausar
              </SubmitButton>
            </form>
          )}
          {b.status === "PAUSED" && (
            <form action={resumeEmailBroadcastAction.bind(null, b.id)}>
              <SubmitButton pendingText="Reanudando…">
                <Play aria-hidden />
                Seguir enviando
              </SubmitButton>
            </form>
          )}
          {(b.status === "SCHEDULED" || b.status === "SENDING" || b.status === "PAUSED") && (
            <form action={cancelEmailBroadcastAction.bind(null, b.id)}>
              <SubmitButton variant="ghost-danger" pendingText="Cancelando…" confirm="¿Cancelar el envío? A quienes faltan ya no les llegará.">
                <CircleX aria-hidden />
                Cancelar
              </SubmitButton>
            </form>
          )}
        </div>
      </PageHeader>

      <div className="space-y-6">
        {b.status === "SCHEDULED" && b.scheduledAt && (
          <Callout tone="neutral" title={`Programado para el ${dateTime(b.scheduledAt)}`}>
            Sale dentro de los 5 minutos siguientes a esa hora. Antes de enviar a cada persona se revisa de nuevo si se dio de baja o rebotó.
          </Callout>
        )}
        {b.status === "PAUSED" && b.note && (
          <Callout tone="danger" title="El envío se pausó solo">
            {b.note} Cuando lo corrijas, toca “Seguir enviando”.
          </Callout>
        )}
        {b.status === "SENDING" && s.pending > 0 && (
          <Callout tone="neutral">
            Sale por tandas de hasta 100 cada pocos minutos, hasta {b.dailyLimit.toLocaleString("es-CL")} correos por día. Faltan{" "}
            {s.pending.toLocaleString("es-CL")}.
          </Callout>
        )}

        <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Enviados" value={s.sent.toLocaleString("es-CL")} hint={`de ${s.total.toLocaleString("es-CL")} personas`} />
          <Stat label="Entregados" value={s.delivered.toLocaleString("es-CL")} hint={pct(s.delivered, s.sent)} />
          <Stat label="Abrieron" value={s.opened.toLocaleString("es-CL")} hint={pct(s.opened, s.delivered || s.sent)} />
          <Stat label="Hicieron clic" value={s.clicked.toLocaleString("es-CL")} hint={pct(s.clicked, s.delivered || s.sent)} />
          <Stat label="Se dieron de baja" value={s.unsubscribed.toLocaleString("es-CL")} hint={pct(s.unsubscribed, s.sent)} />
          <Stat
            label="Rebotes y spam"
            value={(s.bounced + s.complained).toLocaleString("es-CL")}
            hint={s.failed + s.skipped ? `${(s.failed + s.skipped).toLocaleString("es-CL")} no se enviaron` : pct(s.bounced + s.complained, s.sent)}
          />
        </div>
        {ab && (
          <Card className="animate-rise p-4">
            <h2 className="text-sm font-semibold text-slate-900">Prueba A/B de asuntos</h2>
            <p className="mt-0.5 text-xs text-slate-600">
              {ab.winner !== null
                ? `Va ganando el asunto ${ab.winner ? "B" : "A"}.`
                : ab.ready
                  ? "Por ahora van empatados."
                  : `El ganador se muestra cuando cada asunto tenga al menos ${AB_MIN_DELIVERED} correos entregados.`}
            </p>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {ab.variants.map((v) => (
                <li key={v.variant} className={`rounded-lg border p-3 ${ab.winner === v.variant ? "border-brand-500 bg-brand-50" : "border-slate-200"}`}>
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                    Asunto {v.variant ? "B" : "A"}
                    {ab.winner === v.variant && <Trophy aria-label="Ganador" className="size-3.5 text-brand-600" />}
                  </p>
                  <p className="mt-1 text-sm font-medium text-slate-900">{v.subject}</p>
                  <p className="mt-2 text-sm text-slate-700">
                    Abrieron <span className="font-semibold">{pct(v.opened, v.delivered || v.sent)}</span> · clic {pct(v.clicked, v.delivered || v.sent)} ·{" "}
                    {v.sent.toLocaleString("es-CL")} enviados
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <p className="text-xs text-slate-600">
          Las aperturas son aproximadas: algunos correos (como Apple Mail) abren las imágenes solos y otros las bloquean.
        </p>

        <Card className="animate-rise overflow-hidden">
          <nav aria-label="Filtrar personas" className="flex flex-wrap gap-1.5 border-b border-slate-100 p-3">
            {(Object.keys(EMAIL_RECIPIENT_FILTERS) as EmailRecipientFilter[]).map((f) => (
              <Link
                key={f}
                href={f === "todos" ? `/broadcasts/email/${b.id}` : `/broadcasts/email/${b.id}?filtro=${f}`}
                aria-current={f === filter ? "page" : undefined}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors duration-150 ${
                  f === filter ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {EMAIL_RECIPIENT_FILTERS[f]}
              </Link>
            ))}
          </nav>
          {recipients.length === 0 ? (
            <EmptyState icon={<CircleX />} title="Nadie en este filtro" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-4 py-2.5">Persona</th>
                    <th className="px-4 py-2.5">Correo</th>
                    <th className="px-4 py-2.5">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recipients.map((r) => {
                    const st = state(r);
                    return (
                      <tr key={r.id}>
                        <td className="px-4 py-2.5 font-medium text-slate-900">{r.name || "–"}</td>
                        <td className="px-4 py-2.5 text-slate-600">{r.email}</td>
                        <td className="px-4 py-2.5">
                          <Badge tone={st.tone}>{st.label}</Badge>
                          {r.error && (r.status === "FAILED" || r.status === "SKIPPED") && <p className="mt-1 max-w-xs text-xs text-slate-600">{r.error}</p>}
                        </td>
                      </tr>
                    );
                  })}
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
