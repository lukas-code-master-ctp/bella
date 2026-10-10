import Link from "next/link";
import { CircleX, FlaskConical, Inbox, MessageCircleWarning, Trophy } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatAgo } from "@/lib/dates";
import { attentionOf } from "@/lib/domain/attention";
import { CHANNEL_LABEL } from "@/lib/labels";
import { buttonClass, Card, EmptyState, inputClass, PageHeader } from "@/components/ui";
import { Board } from "./board";

export default async function FunnelPage({ searchParams }: { searchParams: Promise<{ executive?: string; sort?: string }> }) {
  const user = await requireUser();
  const { executive, sort } = await searchParams;
  const byScore = sort === "score";
  const waitingFirst = sort === "waiting";
  const scope: Prisma.LeadWhereInput =
    user.role === "ADMIN" ? (executive ? { assigneeId: executive === "none" ? null : executive } : {}) : { assigneeId: user.id };

  const [stages, leads, closed, executives] = await Promise.all([
    db.stage.findMany({ orderBy: { position: "asc" } }),
    db.lead.findMany({
      where: { ...scope, status: "OPEN" },
      include: {
        contact: { include: { tags: { include: { tag: true } } } },
        assignee: true,
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: byScore ? [{ score: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }] : { updatedAt: "desc" },
    }),
    db.lead.groupBy({ by: ["status"], where: { ...scope, status: { not: "OPEN" } }, _count: { _all: true } }),
    user.role === "ADMIN" ? db.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }) : [],
  ]);
  const count = (s: string) => closed.find((c) => c.status === s)?._count._all ?? 0;
  const now = new Date();
  const humanStages = new Set(stages.filter((s) => s.requiresHuman).map((s) => s.id));
  const cards = leads.map((l) => {
    const last = l.messages[0] ?? null;
    const attention = attentionOf({ aiEnabled: l.aiEnabled, requiresHuman: humanStages.has(l.stageId), lastMessage: last }, now);
    return { lead: l, last, attention, waitingSince: attention === "waiting" && last ? last.createdAt : null };
  });
  // Sin atender primero, el que lleva más tiempo esperando arriba; el resto queda como venía.
  if (waitingFirst) {
    cards.sort((a, b) => (a.waitingSince?.getTime() ?? Infinity) - (b.waitingSince?.getTime() ?? Infinity));
  }
  const waiting = cards.filter((c) => c.attention === "waiting").length;

  return (
    <>
      <PageHeader title="Funnel de ventas" description="Arrastra los leads entre etapas o abre uno para ver la conversación.">
        <Link href="/simulator" className={buttonClass("primary")}>
          <FlaskConical aria-hidden />
          Probar en simulador
        </Link>
      </PageHeader>

      <div className="stagger mb-6 flex flex-wrap items-center gap-3">
        <Stat icon={<Inbox />} label="Abiertos" value={leads.length} tone="text-brand-700 bg-brand-50" />
        <Stat icon={<Trophy />} label="Ganados" value={count("WON")} tone="text-emerald-700 bg-emerald-50" />
        <Stat icon={<CircleX />} label="Perdidos" value={count("LOST")} tone="text-rose-700 bg-rose-50" />
        {waiting > 0 && <Stat icon={<MessageCircleWarning />} label="Sin atender" value={waiting} tone="text-amber-700 bg-amber-50" />}
        <form className="ml-auto flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
          {user.role === "ADMIN" && (
            <>
              <label htmlFor="executive" className="sr-only">
                Ejecutivo
              </label>
              <select id="executive" name="executive" defaultValue={executive ?? ""} className={`${inputClass} sm:w-56`}>
                <option value="">Todos los ejecutivos</option>
                <option value="none">Sin asignar</option>
                {executives.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </>
          )}
          <label htmlFor="sort" className="sr-only">
            Orden
          </label>
          <select id="sort" name="sort" defaultValue={byScore ? "score" : waitingFirst ? "waiting" : ""} className={`${inputClass} sm:w-48`}>
            <option value="">Más recientes</option>
            <option value="score">Mayor puntaje</option>
            <option value="waiting">Sin atender primero</option>
          </select>
          <button className={buttonClass("secondary")}>Aplicar</button>
        </form>
      </div>

      {stages.length === 0 ? (
        <Card>
          <EmptyState icon={<Inbox />} title="No hay etapas configuradas">
            Créalas en{" "}
            <Link href="/settings/funnel" className="font-medium text-brand-700 underline-offset-2 hover:underline">
              Configuración → Funnel y etiquetas
            </Link>
            .
          </EmptyState>
        </Card>
      ) : (
        <Board
          stages={stages.map(({ id, name, color, requiresHuman }) => ({ id, name, color, requiresHuman }))}
          leads={cards.map(({ lead: l, last, attention, waitingSince }) => ({
            id: l.id,
            stageId: l.stageId,
            name: l.contact.name,
            channel: CHANNEL_LABEL[l.contact.channel],
            assignee: l.assignee?.name ?? null,
            aiEnabled: l.aiEnabled,
            attention,
            waitingFor: waitingSince ? formatAgo(waitingSince, now) : null,
            lastMessage: last ? last.body || (last.mediaUrl ? "🎤 Nota de voz" : "") : null,
            summary: l.aiSummary,
            score: l.score,
            scoreReason: l.scoreReason,
            tags: l.contact.tags.map((ct) => ({ label: ct.tag.name, color: ct.tag.color })),
            updatedAt: l.updatedAt.toISOString(),
          }))}
        />
      )}
    </>
  );
}

function Stat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white py-2 pl-2 pr-4 shadow-xs">
      <span className={`flex size-8 items-center justify-center rounded-lg [&_svg]:size-4 ${tone}`} aria-hidden>
        {icon}
      </span>
      <span className="text-sm text-slate-600">{label}</span>
      <span key={value} className="inline-block animate-pop text-lg font-bold tabular-nums text-slate-900">
        {value}
      </span>
    </div>
  );
}
