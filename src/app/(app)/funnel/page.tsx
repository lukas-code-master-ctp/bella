import Link from "next/link";
import { FlaskConical, Inbox, MessageCircleWarning } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatAgo } from "@/lib/dates";
import { attentionOf } from "@/lib/domain/attention";
import { campaignOf } from "@/lib/domain/attribution";
import { formatDue } from "@/lib/dates";
import { bucketOf } from "@/lib/domain/tasks";
import { listFunnels } from "@/lib/domain/funnels";
import { formatDuration } from "@/lib/domain/metrics";
import { lateLeads } from "@/lib/domain/sla";
import { CHANNEL_LABEL } from "@/lib/labels";
import { buttonClass, Card, ClearFilters, EmptyState } from "@/components/ui";
import { ParamSelect } from "./filters";
import { LeadDrawer } from "./lead-drawer";
import { LeadView } from "../leads/[id]/lead-view";
import { Board } from "./board";
import { AutoRefresh } from "@/components/auto-refresh";

const PER_STAGE = 100;

export default async function FunnelPage({
  searchParams,
}: {
  searchParams: Promise<{ executive?: string; sort?: string; funnel?: string; ver?: string; lead?: string }>;
}) {
  const user = await requireUser();
  const query = await searchParams;
  const { executive, sort, funnel: funnelParam } = query;
  const onlyWaiting = query.ver === "sin-atender";
  const selected = query.lead ?? null;
  // Mismo filtro con un parámetro cambiado (null lo quita): los filtros viven en la URL.
  const hrefWith = (change: Record<string, string | null>) => {
    const next = new URLSearchParams(Object.entries(query).filter((e): e is [string, string] => typeof e[1] === "string"));
    for (const [k, v] of Object.entries(change)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    return qs ? `/funnel?${qs}` : "/funnel";
  };
  const funnels = await listFunnels();
  const funnel = funnels.find((f) => f.id === funnelParam) ?? funnels[0];
  // Los ejecutivos parten con "Sin atender primero" (su trabajo es responder); los admins, con "Más recientes".
  const defaultOrder = user.role === "ADMIN" ? "recent" : "waiting";
  const order = sort || defaultOrder;
  const byScore = order === "score";
  const waitingFirst = order === "waiting";
  const scope: Prisma.LeadWhereInput = {
    ...(user.role === "ADMIN" ? (executive ? { assigneeId: executive === "none" ? null : executive } : {}) : { assigneeId: user.id }),
    ...(funnel ? { stage: { funnelId: funnel.id } } : {}),
  };

  const [stages, open, closed, executives] = await Promise.all([
    db.stage.findMany({ where: funnel ? { funnelId: funnel.id } : {}, orderBy: { position: "asc" } }),
    db.lead.groupBy({ by: ["stageId"], where: { ...scope, status: "OPEN" }, _count: { _all: true } }),
    db.lead.groupBy({ by: ["status"], where: { ...scope, status: { not: "OPEN" } }, _count: { _all: true } }),
    user.role === "ADMIN" ? db.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }) : [],
  ]);
  // shortcut: cada etapa muestra sus primeros PER_STAGE leads y "Sin atender" cuenta solo esos;
  // si una etapa suele pasar ese número, agregar "cargar más" por etapa.
  const leads = (
    await Promise.all(
      stages.map((stage) =>
        db.lead.findMany({
          where: { ...scope, status: "OPEN", stageId: stage.id },
          include: {
            contact: { include: { tags: { include: { tag: true } } } },
            assignee: true,
            messages: { orderBy: { createdAt: "desc" }, take: 1 },
            tasks: { where: { completedAt: null }, orderBy: { dueAt: "asc" }, take: 1, select: { title: true, dueAt: true } },
            source: { select: { campaignName: true, utmCampaign: true, adHeadline: true, adId: true } },
          },
          orderBy: byScore ? [{ score: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }] : { updatedAt: "desc" },
          take: PER_STAGE,
        }),
      ),
    )
  ).flat();
  const openIn = (stageId: string) => open.find((o) => o.stageId === stageId)?._count._all ?? 0;
  const count = (s: string) => closed.find((c) => c.status === s)?._count._all ?? 0;
  const now = new Date();
  const humanStages = new Set(stages.filter((s) => s.requiresHuman).map((s) => s.id));
  const cards = leads.map((l) => {
    const last = l.messages[0] ?? null;
    const attention = attentionOf({ aiEnabled: l.aiEnabled, requiresHuman: humanStages.has(l.stageId), lastMessage: last, noReplyNeededAt: l.noReplyNeededAt }, now);
    return { lead: l, last, attention, waitingSince: attention === "waiting" && last ? last.createdAt : null };
  });
  // Sin atender primero, el que lleva más tiempo esperando arriba; el resto queda como venía.
  if (waitingFirst) {
    cards.sort((a, b) => (a.waitingSince?.getTime() ?? Infinity) - (b.waitingSince?.getTime() ?? Infinity));
  }
  const waiting = cards.filter((c) => c.attention === "waiting").length;
  const late = await lateLeads(leads.map((l) => l.id), now);
  // El embudo elegido no cuenta como filtro: "Limpiar" lo mantiene.
  const filtered = onlyWaiting || (user.role === "ADMIN" && Boolean(executive)) || order !== defaultOrder;
  const shown = onlyWaiting ? cards.filter((c) => c.attention === "waiting") : cards;

  return (
    <>
      <AutoRefresh />
      <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Funnel</h1>
        {funnels.length > 1 && funnel && (
          <ParamSelect name="funnel" label="Embudo" value={funnel.id} options={funnels.map((f) => ({ value: f.id, label: f.name }))} />
        )}
        <dl className="flex items-baseline gap-4 text-sm text-slate-600">
          <Stat label="Abiertos" value={open.reduce((n, o) => n + o._count._all, 0)} />
          <Stat label="Ganados" value={count("WON")} href="/chats?estado=won" />
          <Stat label="Perdidos" value={count("LOST")} href="/chats?estado=lost" />
        </dl>
        <span aria-hidden className="hidden h-6 w-px bg-slate-200 sm:block" />
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={hrefWith({ ver: onlyWaiting ? null : "sin-atender" })}
            scroll={false}
            aria-current={onlyWaiting ? "true" : undefined}
            className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors duration-150 [&_svg]:size-4 ${
              onlyWaiting ? "border-amber-300 bg-amber-50 text-amber-900" : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"
            }`}
          >
            <MessageCircleWarning aria-hidden />
            Sin atender
            <span className="tabular-nums">{waiting}</span>
          </Link>
          {user.role === "ADMIN" && (
            <ParamSelect
              name="executive"
              label="Ejecutivo"
              value={executive ?? ""}
              options={[
                { value: "", label: "Todos los ejecutivos" },
                { value: "none", label: "Sin asignar" },
                ...executives.map((e) => ({ value: e.id, label: e.name })),
              ]}
            />
          )}
          <ParamSelect
            name="sort"
            label="Orden"
            value={byScore ? "score" : waitingFirst ? "waiting" : "recent"}
            options={[
              { value: "recent", label: "Más recientes" },
              { value: "score", label: "Mayor puntaje" },
              { value: "waiting", label: "Sin atender primero" },
            ]}
          />
          {filtered && <ClearFilters href={hrefWith({ executive: null, ver: null, sort: null })} compact />}
        </div>
        {user.role === "ADMIN" && (
          <Link href="/chats/simulator" className={buttonClass("secondary", "sm", "ml-auto")}>
            <FlaskConical aria-hidden />
            Probar en simulador
          </Link>
        )}
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
          leadHref={hrefWith({ lead: "__id__" })}
          stages={stages.map(({ id, name, color, requiresHuman }) => ({
            id,
            name,
            color,
            requiresHuman,
            hidden: onlyWaiting ? 0 : openIn(id) - leads.filter((l) => l.stageId === id).length,
          }))}
          leads={shown.map(({ lead: l, last, attention, waitingSince }) => ({
            id: l.id,
            stageId: l.stageId,
            name: l.contact.name,
            channel: CHANNEL_LABEL[l.contact.channel],
            channelKey: l.contact.channel,
            assignee: l.assignee?.name ?? null,
            aiEnabled: l.aiEnabled,
            attention,
            waitingFor: waitingSince ? formatAgo(waitingSince, now) : null,
            late: late.has(l.id) ? formatDuration(late.get(l.id)!) : null,
            lastMessage: last ? last.body || (last.mediaUrl ? (last.mediaType?.startsWith("audio/") ? "🎤 Nota de voz" : "📎 Archivo") : "") : null,
            summary: l.aiSummary,
            score: l.score,
            scoreReason: l.scoreReason,
            nextTask: l.tasks[0]
              ? { title: l.tasks[0].title, due: formatDue(l.tasks[0].dueAt, now), bucket: bucketOf(l.tasks[0].dueAt, now) }
              : null,
            tags: l.contact.tags.map((ct) => ({ label: ct.tag.name, color: ct.tag.color })),
            origin: campaignOf(l.source),
            updatedAt: l.updatedAt.toISOString(),
          }))}
        />
      )}

      {selected && (
        <LeadDrawer closeHref={hrefWith({ lead: null })} fullHref={`/leads/${selected}`}>
          <LeadView id={selected} back={{ href: hrefWith({ lead: null }), label: "Cerrar y volver al funnel" }} layout="drawer" />
        </LeadDrawer>
      )}
    </>
  );
}

// Los cerrados salen del tablero (incluso de una columna "Perdidos"): se ven en Chats con su filtro.
function Stat({ label, value, href }: { label: string; value: number; href?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt>{href ? <Link href={href} title={`Ver ${label.toLowerCase()} en Chats`} className="underline decoration-slate-300 underline-offset-4 hover:text-slate-900">{label}</Link> : label}</dt>
      <dd key={value} className="inline-block animate-pop text-base font-bold tabular-nums text-slate-900">
        {value}
      </dd>
    </div>
  );
}
