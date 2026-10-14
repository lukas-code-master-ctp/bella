import Link from "next/link";
import { BellRing, CalendarClock, MessageCircleMore } from "lucide-react";
import { db } from "@/lib/db";
import { formatChileDateTime, formatDelay, getFollowUpSettings } from "@/lib/domain/follow-ups";
import { FOLLOW_UP_CHECK_MS } from "@/lib/ai/follow-ups";
import { Avatar, Badge, EmptyState, PageHeader } from "@/components/ui";
import { Callout, Panel, StatusPill } from "@/components/settings-ui";
import { FollowUpsForm, RunNowForm } from "./form";

export default async function FollowUpsPage() {
  const s = await getFollowUpSettings();
  const upcoming = await db.lead.findMany({
    where: { status: "OPEN", aiEnabled: true, followUpAt: { not: null } },
    include: { contact: true },
    orderBy: { followUpAt: "asc" },
    take: 20,
  });
  const now = new Date();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Seguimientos"
        description="Cuando un lead deja de responder, la asistente le vuelve a escribir en los plazos que definas. También agenda recontactos para una fecha cuando el cliente lo pide (ej. después de una visita)."
      />
      <Panel
        icon={<MessageCircleMore />}
        title="Seguimiento automático"
        description="Solo en leads abiertos con la IA activa: si un ejecutivo toma la conversación, no hay seguimientos automáticos."
        aside={<StatusPill on={s.enabled} onLabel="Encendido" offLabel="Apagado" />}
      >
        <FollowUpsForm
          enabled={s.enabled}
          delays={s.delays.map(formatDelay).join(", ")}
          sendFrom={s.sendFrom}
          sendTo={s.sendTo}
          instructions={s.instructions}
        />
      </Panel>
      <Callout tone="neutral">
        Los seguimientos vencidos se revisan cada 15 minutos con el cron de Vercel y, mientras alguien del equipo usa Beliapp,
        cada {FOLLOW_UP_CHECK_MS / 60_000} minutos. Si la asistente decide que no corresponde escribir (por ejemplo, el
        cliente se despidió), no insiste.
      </Callout>

      <Panel
        icon={<CalendarClock />}
        title="Próximos seguimientos"
        description={s.enabled ? `${upcoming.length} programados` : "Los seguimientos están desactivados."}
        aside={s.enabled && upcoming.length > 0 ? <RunNowForm /> : undefined}
      >
        {upcoming.length === 0 ? (
          <EmptyState icon={<BellRing />} title="No hay seguimientos programados">
            Se programan solos cada vez que la asistente responde a un lead.
          </EmptyState>
        ) : (
          <ul className="stagger divide-y divide-slate-100">
            {upcoming.map((l) => {
              const due = l.followUpAt! <= now;
              return (
                <li key={l.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm transition-colors duration-100 hover:bg-slate-50">
                  <Avatar name={l.contact.name} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/leads/${l.id}`} className="font-semibold text-slate-900 hover:text-brand-700">
                      {l.contact.name}
                    </Link>
                    <p className="truncate text-xs text-slate-600">
                      {l.followUpReason ? `Agendado por la IA: ${l.followUpReason}` : `Seguimiento ${l.followUpCount + 1} de ${s.delays.length}`}
                    </p>
                  </div>
                  <span className="flex items-center gap-2 tabular-nums text-slate-700">
                    {due && <Badge tone="warning">Vencido</Badge>}
                    {formatChileDateTime(l.followUpAt!)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
