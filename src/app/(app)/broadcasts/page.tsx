import Link from "next/link";
import { Mail, Megaphone, MessageSquareText, Plus } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { broadcastStats, EMPTY_STATS } from "@/lib/domain/broadcasts";
import { emailBroadcastStats, EMPTY_EMAIL_STATS } from "@/lib/domain/email-broadcasts";
import { AutoRefresh } from "@/components/auto-refresh";
import { buttonClass, Card, EmptyState, PageHeader } from "@/components/ui";
import { BroadcastStatusBadge, dateTime, pct, ResultBar } from "./ui";

const tabClass = (on: boolean) =>
  `rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors duration-150 ${on ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`;

/** Pestañas WhatsApp / Correo: cada canal tiene sus propios envíos. */
function ChannelTabs({ email }: { email: boolean }) {
  return (
    <nav aria-label="Canal" className="mb-4 flex gap-2">
      <Link href="/broadcasts" aria-current={!email ? "page" : undefined} className={tabClass(!email)}>
        WhatsApp
      </Link>
      <Link href="/broadcasts?canal=correo" aria-current={email ? "page" : undefined} className={tabClass(email)}>
        Correo
      </Link>
    </nav>
  );
}

export default async function BroadcastsPage({ searchParams }: { searchParams: Promise<{ canal?: string }> }) {
  await requireAdmin();
  if ((await searchParams).canal === "correo") return <EmailBroadcasts />;
  const broadcasts = await db.broadcast.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  const stats = await broadcastStats(broadcasts.map((b) => b.id));
  const sending = broadcasts.some((b) => b.status === "SENDING");

  return (
    <>
      {sending && <AutoRefresh seconds={15} />}
      <PageHeader
        title="Envíos masivos"
        description="Envía una plantilla de WhatsApp aprobada por Meta a una lista de personas. Cada una queda como lead: si responde, la conversación sigue en Chats."
      >
        <div className="flex flex-wrap gap-2">
          <Link href="/broadcasts/templates" className={buttonClass("secondary")}>
            <MessageSquareText aria-hidden />
            Plantillas
          </Link>
          <Link href="/broadcasts/new" className={buttonClass()}>
            <Plus aria-hidden />
            Nuevo envío
          </Link>
        </div>
      </PageHeader>
      <ChannelTabs email={false} />

      {broadcasts.length === 0 ? (
        <Card className="animate-rise">
          <EmptyState icon={<Megaphone />} title="Aún no hay envíos">
            Crea el primero con “Nuevo envío”: subes los números o los eliges desde el funnel, eliges la plantilla y la envías.
          </EmptyState>
        </Card>
      ) : (
        <Card className="animate-rise overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-4 py-2.5">Envío</th>
                  <th className="px-4 py-2.5">Estado</th>
                  <th className="px-4 py-2.5 text-right">Personas</th>
                  <th className="px-4 py-2.5">Resultado</th>
                  <th className="px-4 py-2.5 text-right">Leídos</th>
                  <th className="px-4 py-2.5 text-right">Respondieron</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {broadcasts.map((b) => {
                  const s = stats.get(b.id) ?? EMPTY_STATS;
                  return (
                    <tr key={b.id} className="transition-colors duration-150 hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <Link href={`/broadcasts/${b.id}`} className="font-semibold text-slate-900 hover:text-brand-700 hover:underline">
                          {b.name}
                        </Link>
                        <p className="text-xs text-slate-600">
                          {b.templateName} · {b.status === "SCHEDULED" && b.scheduledAt ? `programado para el ${dateTime(b.scheduledAt)}` : dateTime(b.createdAt)}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <BroadcastStatusBadge status={b.status} stats={s} />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{s.total.toLocaleString("es-CL")}</td>
                      <td className="px-4 py-3">
                        <ResultBar stats={s} />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{pct(s.read, s.sent)}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{s.replied.toLocaleString("es-CL")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

async function EmailBroadcasts() {
  const broadcasts = await db.emailBroadcast.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  const stats = await emailBroadcastStats(broadcasts.map((b) => b.id));
  const sending = broadcasts.some((b) => b.status === "SENDING");

  return (
    <>
      {sending && <AutoRefresh seconds={15} />}
      <PageHeader
        title="Envíos masivos"
        description="Envía newsletters y promociones por correo desde el dominio de tu empresa. Cada correo lleva un enlace para darse de baja."
      >
        <Link href="/broadcasts/email/new" className={buttonClass()}>
          <Plus aria-hidden />
          Nuevo correo
        </Link>
      </PageHeader>
      <ChannelTabs email />

      {broadcasts.length === 0 ? (
        <Card className="animate-rise">
          <EmptyState icon={<Mail />} title="Aún no hay correos">
            Crea el primero con “Nuevo correo”: lo armas con bloques, subes la lista o la eliges desde el funnel, y revisas antes de enviar.
          </EmptyState>
        </Card>
      ) : (
        <Card className="animate-rise overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-4 py-2.5">Envío</th>
                  <th className="px-4 py-2.5">Estado</th>
                  <th className="px-4 py-2.5 text-right">Personas</th>
                  <th className="px-4 py-2.5 text-right">Abrieron</th>
                  <th className="px-4 py-2.5 text-right">Clics</th>
                  <th className="px-4 py-2.5 text-right">Bajas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {broadcasts.map((b) => {
                  const s = stats.get(b.id) ?? EMPTY_EMAIL_STATS;
                  return (
                    <tr key={b.id} className="transition-colors duration-150 hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <Link href={`/broadcasts/email/${b.id}`} className="font-semibold text-slate-900 hover:text-brand-700 hover:underline">
                          {b.name}
                        </Link>
                        <p className="max-w-xs truncate text-xs text-slate-600">
                          {b.subject}{b.subjectB ? " (A/B)" : ""} · {b.status === "SCHEDULED" && b.scheduledAt ? `programado para el ${dateTime(b.scheduledAt)}` : dateTime(b.createdAt)}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <BroadcastStatusBadge status={b.status} stats={s} />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{s.total.toLocaleString("es-CL")}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{pct(s.opened, s.delivered || s.sent)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{pct(s.clicked, s.delivered || s.sent)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{s.unsubscribed.toLocaleString("es-CL")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
