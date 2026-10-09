import Link from "next/link";
import { BellRing } from "lucide-react";
import { db } from "@/lib/db";
import { formatChileDateTime, formatDelay, getFollowUpSettings } from "@/lib/domain/follow-ups";
import { FOLLOW_UP_CHECK_MS } from "@/lib/ai/follow-ups";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
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
    <>
      <PageHeader
        title="Seguimientos"
        description="Cuando un lead deja de responder, la asistente le vuelve a escribir en los plazos que definas. También agenda recontactos para una fecha cuando el cliente lo pide (ej. después de una visita). Solo en leads abiertos con la IA activa: si un ejecutivo toma la conversación, no hay seguimientos automáticos."
      />
      <Card className="mb-6 p-5">
        <FollowUpsForm
          enabled={s.enabled}
          delays={s.delays.map(formatDelay).join(", ")}
          sendFrom={s.sendFrom}
          sendTo={s.sendTo}
          instructions={s.instructions}
        />
        <p className="mt-4 text-xs text-slate-600">
          Los seguimientos vencidos se envían una vez al día con el cron de Vercel y, mientras alguien del equipo usa
          Bella, cada {FOLLOW_UP_CHECK_MS / 60_000} minutos. Si la asistente decide que no corresponde escribir (por
          ejemplo, el cliente se despidió), no insiste.
        </p>
      </Card>

      <Card>
        <div className="p-5 pb-0">
          <CardHeader title="Próximos seguimientos" description={s.enabled ? undefined : "Los seguimientos están desactivados."}>
            {s.enabled && <RunNowForm />}
          </CardHeader>
        </div>
        {upcoming.length === 0 ? (
          <EmptyState icon={<BellRing />} title="No hay seguimientos programados">
            Se programan solos cada vez que la asistente responde a un lead.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {upcoming.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm">
                <Link href={`/leads/${l.id}`} className="font-semibold text-slate-900 hover:text-brand-700">
                  {l.contact.name}
                </Link>
                <span className="text-slate-600">
                  {l.followUpReason ? `Agendado por la IA: ${l.followUpReason}` : `Seguimiento ${l.followUpCount + 1} de ${s.delays.length}`}
                </span>
                <span className="ml-auto flex items-center gap-2 tabular-nums text-slate-700">
                  {l.followUpAt! <= now && <Badge tone="warning">Vencido</Badge>}
                  {formatChileDateTime(l.followUpAt!)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
