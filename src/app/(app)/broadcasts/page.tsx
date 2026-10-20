import Link from "next/link";
import { Megaphone, MessageSquareText, Plus } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { broadcastStats, EMPTY_STATS } from "@/lib/domain/broadcasts";
import { AutoRefresh } from "@/components/auto-refresh";
import { buttonClass, Card, EmptyState, PageHeader } from "@/components/ui";
import { BroadcastStatusBadge, dateTime, pct, ResultBar } from "./ui";

export default async function BroadcastsPage() {
  await requireAdmin();
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
