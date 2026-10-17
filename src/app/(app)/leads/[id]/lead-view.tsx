import { fileKind } from "@/lib/media";
import { Fragment } from "react";
import Link from "next/link";
import type { LeadSource } from "@prisma/client";
import { notFound } from "next/navigation";
import { ArrowLeft, Ban, BellOff, Bot, BotOff, CircleX, MessageCircleWarning, ExternalLink, Sparkles, Target, Trophy } from "lucide-react";
import { canAccessLead, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { displayFieldValue } from "@/lib/domain/fields";
import { stageOptions } from "@/lib/domain/funnels";
import { formatChileDateTime, getFollowUpSettings } from "@/lib/domain/follow-ups";
import { CHANNEL_LABEL } from "@/lib/labels";
import { sourceLabel } from "@/lib/domain/attribution";
import { formatAgo, formatLocal, startOfLocalDay, TIME_ZONE, toLocalInput } from "@/lib/dates";
import { attentionOf } from "@/lib/domain/attention";
import { markLeadNotificationsRead } from "@/lib/domain/notifications";
import { awaitingAmountStageIds } from "@/lib/domain/leads";
import { Avatar, Badge, Card, inputClass, TagPill } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { LinkPending } from "@/components/link-pending";
import { ScoreBadge } from "@/components/score-badge";
import {
  addTagAction,
  moveStageAction,
  cancelFollowUpAction,
  optBackInAction,
  removeTagAction,
  setAssigneeAction,
} from "./actions";
import { FollowUpNowButton, LeadChat, RefreshInsightsForm } from "./client";
import { AiPausedChip, ConfirmAmountForm, LeadMenu } from "./lead-menu";
import { LeadTabs } from "./lead-tabs";
import { LeadFieldsForm } from "./fields-form";
import { TaskForm } from "../../tasks/task-form";
import { TaskItem } from "../../tasks/task-item";
import { AutoRefresh } from "@/components/auto-refresh";

const EVENT_LABEL: Record<string, string> = {
  CREATED: "Lead creado",
  STAGE_CHANGED: "Cambio de etapa",
  TAG_ADDED: "Etiqueta agregada",
  TAG_REMOVED: "Etiqueta quitada",
  CONTACT_UPDATED: "Datos del contacto",
  FIELD_UPDATED: "Campo del cliente",
  ASSIGNED: "Asignado",
  UNASSIGNED: "Sin asignar",
  HANDOFF: "Derivado a humano",
  AI_PAUSED: "IA pausada",
  AI_RESUMED: "IA reactivada",
  WON: "Ganado",
  LOST: "Perdido",
  REOPENED: "Reabierto",
  BLOCKED: "Contacto bloqueado",
  UNBLOCKED: "Contacto desbloqueado",
  OPTED_OUT: "Pidió no recibir más envíos masivos:",
  OPTED_IN: "Vuelve a recibir envíos masivos",
  CONTACT_MERGED: "Contactos fusionados:",
  FOLLOW_UP_SENT: "Seguimiento enviado",
  FOLLOW_UP_SKIPPED: "Seguimiento omitido",
  FOLLOW_UP_SCHEDULED: "Recontacto agendado",
  FOLLOW_UP_CANCELED: "Seguimientos cancelados",
  TASK_CREATED: "Tarea creada:",
  TASK_DONE: "Tarea cumplida:",
  TASK_REOPENED: "Tarea pendiente otra vez:",
  TASK_DELETED: "Tarea eliminada:",
};

const ACTOR_LABEL = { AI: "IA", USER: "", SYSTEM: "Sistema" } as const;

function describe(data: Record<string, unknown>) {
  if (Array.isArray(data.merged)) return data.merged.join(", ");
  if (data.field) return `${data.field}: ${data.value ?? "borrado"}`;
  if (data.from && data.to) return `${data.from} → ${data.to}`;
  if (data.tag) return String(data.tag);
  if (data.name || data.email) return [data.name, data.email].filter(Boolean).join(" · ");
  if (data.title) return String(data.title);
  if (data.assigneeName) return String(data.assigneeName);
  if (typeof data.amount === "number") return `$${data.amount.toLocaleString("es-CL")}`;
  if (typeof data.number === "number") return `${data.number} de ${data.total}`;
  if (typeof data.at === "string") return formatChileDateTime(new Date(data.at));
  return "";
}

const time = (d: Date) =>
  d.toLocaleString("es-CL", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TIME_ZONE });

/**
 * Conversación y ficha de un lead. Se usa en su página (/leads/[id]) y como panel dentro de Chats
 * (/chats?lead=…) o el panel lateral del funnel (/funnel?lead=…): `back` es adónde lleva la flecha
 * y `layout` ajusta los altos a cada lugar.
 */
export async function LeadView({
  id,
  back = { href: "/funnel", label: "Volver al funnel" },
  layout = "page",
}: {
  id: string;
  back?: { href: string; label: string };
  layout?: "page" | "pane" | "drawer";
}) {
  const inPane = layout === "pane";
  const user = await requireUser();
  const lead = await db.lead.findUnique({
    where: { id },
    include: {
      contact: { include: { tags: { include: { tag: true } }, leads: { where: { status: "OPEN" }, select: { id: true } } } },
      stage: true,
      assignee: true,
      source: true,
      conversions: { orderBy: { createdAt: "asc" }, select: { id: true, kind: true, status: true, error: true, sentAt: true } },
      variant: { select: { name: true } },
      messages: { include: { user: true }, orderBy: { createdAt: "asc" } },
      events: { include: { user: true }, orderBy: { createdAt: "desc" } },
      tasks: { include: { assignee: true }, orderBy: [{ completedAt: { sort: "desc", nulls: "first" } }, { dueAt: "asc" }] },
    },
  });
  if (!lead || !canAccessLead(user, lead)) notFound();

  const [stages, tags, executives, fields, followUps, waNumber, awaitingStages] = await Promise.all([
    stageOptions(),
    db.tag.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] }),
    user.role === "ADMIN" ? db.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }) : [],
    db.customField.findMany({
      orderBy: { position: "asc" },
      include: { values: { where: { contactId: lead.contactId } } },
    }),
    getFollowUpSettings(),
    lead.contact.waPhoneNumberId
      ? db.whatsAppNumber.findUnique({ where: { phoneNumberId: lead.contact.waPhoneNumberId }, select: { label: true } })
      : null,
    awaitingAmountStageIds(),
    markLeadNotificationsRead(user.id, lead.id),
  ]);
  const ownTagIds = new Set(lead.contact.tags.map((t) => t.tagId));
  const isOpen = lead.status === "OPEN";
  const awaitingAmount = isOpen && awaitingStages.includes(lead.stageId);
  const lastMessage = lead.messages.at(-1) ?? null;
  const waitingSince =
    isOpen && attentionOf({ aiEnabled: lead.aiEnabled, requiresHuman: lead.stage.requiresHuman, lastMessage }) === "waiting"
      ? lastMessage!.createdAt
      : null;
  const now = new Date();
  // Mañana a las 10:00 (Chile) como vencimiento sugerido.
  const defaultDue = toLocalInput(new Date(startOfLocalDay(now, 1).getTime() + 10 * 3_600_000));
  const pendingTasks = lead.tasks.filter((t) => !t.completedAt);
  const otherOpenLead = lead.contact.leads.find((l) => l.id !== lead.id)?.id ?? null;

  return (
    <div className="@container">
    <div className="grid gap-6 @3xl:grid-cols-[minmax(0,1fr)_320px]">
      {/* Chats y el funnel ya refrescan la página entera. */}
      {layout === "page" && <AutoRefresh />}
      <Card
        className={`flex min-h-[32rem] flex-col overflow-hidden ${
          layout === "drawer" ? "h-[75dvh]" : inPane ? "h-[calc(100dvh-9rem)] lg:h-[calc(100dvh-13.5rem)]" : "h-[calc(100dvh-9rem)] lg:h-[calc(100dvh-7.5rem)]"
        }`}
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-3 py-3 sm:px-4">
          <Link
            href={back.href}
            aria-label={back.label}
            scroll={false}
            className="relative flex size-10 items-center justify-center rounded-lg text-slate-500 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-900"
          >
            <ArrowLeft aria-hidden className="size-5" />
            <LinkPending className="mx-1.5" />
          </Link>
          <Avatar name={lead.contact.name} size="lg" />
          <div className="min-w-0">
            <h1 className="truncate font-semibold text-slate-900">{lead.contact.name}</h1>
            <p className="text-xs text-slate-600">
              {[waNumber ? `${CHANNEL_LABEL[lead.contact.channel]} (${waNumber.label})` : CHANNEL_LABEL[lead.contact.channel], lead.contact.phone, lead.stage.name, lead.variant && `Prueba A/B: ${lead.variant.name}`]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {lead.contact.blockedAt && (
              <Badge tone="danger">
                <Ban aria-hidden />
                Bloqueado
              </Badge>
            )}
            {lead.status === "WON" && (
              <Badge tone="success">
                <Trophy aria-hidden />
                Ganado
              </Badge>
            )}
            {lead.status === "LOST" && (
              <Badge tone="danger">
                <CircleX aria-hidden />
                Perdido
              </Badge>
            )}
            {awaitingAmount && (
              <Badge tone="success">
                <Trophy aria-hidden />
                Venta por confirmar
              </Badge>
            )}
            {waitingSince && (
              <Badge tone="warning">
                <MessageCircleWarning aria-hidden />
                Sin atender · {formatAgo(waitingSince, new Date())}
              </Badge>
            )}
            {lead.aiEnabled ? (
              <Badge tone="success">
                <Bot aria-hidden />
                IA respondiendo
              </Badge>
            ) : (
              <AiPausedChip leadId={lead.id} canResume={isOpen && !lead.contact.blockedAt} />
            )}
            <LeadMenu
              leadId={lead.id}
              isOpen={isOpen}
              canReopen={!isOpen && !otherOpenLead}
              blocked={Boolean(lead.contact.blockedAt)}
              canMerge={user.role === "ADMIN" && lead.contact.channel !== "SIMULATOR"}
              aiEnabled={lead.aiEnabled}
            />
          </div>
        </div>

        <LeadChat
          leadId={lead.id}
          contactName={lead.contact.name}
          userName={user.name}
          simulator={lead.contact.channel === "SIMULATOR"}
          blocked={Boolean(lead.contact.blockedAt)}
          isAdmin={user.role === "ADMIN"}
          messages={lead.messages.map((m) => ({
            id: m.id,
            author: m.author,
            authorName:
              m.author === "CONTACT" ? lead.contact.name : m.author === "AI" ? "Asistente IA" : (m.user?.name ?? "Ejecutivo"),
            body: m.body,
            ...(m.mediaUrl && fileKind(m.mediaType) === "audio" ? { audio: { url: m.mediaUrl, transcript: m.transcript } } : {}),
            ...(m.mediaUrl && fileKind(m.mediaType) !== "audio"
              ? { file: { url: m.mediaUrl, name: m.mediaName ?? "Archivo", kind: fileKind(m.mediaType) } }
              : {}),
            ...(m.deliveryStatus ? { delivery: { status: m.deliveryStatus, error: m.deliveryError } } : {}),
            time: time(m.createdAt),
          }))}
        />
      </Card>

      {/* En pantallas anchas la página no hace scroll: el chat y el sidebar quedan fijos y solo este panel se desplaza. */}
      <aside
        className={`relative @3xl:overflow-y-auto @3xl:overscroll-contain @3xl:pr-1.5 ${inPane ? "@3xl:h-[calc(100dvh-13.5rem)]" : "@3xl:h-[calc(100dvh-7.5rem)]"}`}
      >
        <LeadTabs
          tabs={[
            {
              id: "resumen",
              label: "Resumen",
              panel: (
                <Card className="divide-y divide-slate-100">
                  {awaitingAmount && (
                    <section className="space-y-2 p-4">
                      <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
                        <Trophy aria-hidden className="size-4" />
                        Venta por confirmar
                      </p>
                      <p className="text-sm text-slate-600">Ingresa el monto de la venta para cerrarlo como ganado.</p>
                      <ConfirmAmountForm leadId={lead.id} />
                    </section>
                  )}
                  {(!isOpen || lead.contact.blockedAt) && (
                    <section className="space-y-2 p-4">
                      {!isOpen && (
                        <p className={`flex items-center gap-2 text-sm font-semibold ${lead.status === "WON" ? "text-emerald-700" : "text-rose-700"}`}>
                          {lead.status === "WON" ? <Trophy aria-hidden className="size-4" /> : <CircleX aria-hidden className="size-4" />}
                          {lead.status === "WON"
                            ? `Ganado${lead.amount ? ` · $${lead.amount.toLocaleString("es-CL")}` : ""}`
                            : `Perdido · ${lead.lostReason}`}
                        </p>
                      )}
                      {lead.contact.blockedAt && (
                        <p className="flex items-center gap-2 text-sm text-slate-800">
                          <Ban aria-hidden className="size-4 shrink-0 text-rose-600" />
                          Bloqueado el {formatChileDateTime(lead.contact.blockedAt)}
                          {lead.contact.blockedReason && ` · ${lead.contact.blockedReason}`}
                        </p>
                      )}
                      {!isOpen && otherOpenLead && (
                        <p className="text-sm text-slate-700">
                          El contacto ya tiene otro lead abierto:{" "}
                          <Link href={`/leads/${otherOpenLead}`} className="font-medium text-brand-700 underline">
                            ver lead
                          </Link>
                          .
                        </p>
                      )}
                      <p className="text-xs text-slate-600">Para reabrir o desbloquear, usa el menú ⋯ de arriba.</p>
                    </section>
                  )}
                  {lead.contact.optedOutAt && (
                    <section className="flex flex-wrap items-center gap-x-3 gap-y-1 p-4 text-sm text-slate-800">
                      <BellOff aria-hidden className="size-4 shrink-0 text-amber-600" />
                      <span>Pidió no recibir envíos masivos el {formatChileDateTime(lead.contact.optedOutAt)}.</span>
                      <form action={optBackInAction.bind(null, lead.id)}>
                        <button type="submit" className="font-medium text-brand-700 underline hover:text-brand-800">
                          Volver a incluir
                        </button>
                      </form>
                    </section>
                  )}
                  <section className="p-4">
                    <div className="mb-2.5 flex items-center gap-2">
                      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Resumen IA</h2>
                      {lead.score !== null && <ScoreBadge score={lead.score} className="ml-auto" />}
                    </div>
                    {lead.aiSummary ? (
                      <>
                        <p className="flex gap-1.5 text-sm leading-relaxed text-slate-800">
                          <Sparkles aria-hidden className="mt-1 size-3.5 shrink-0 text-brand-500" />
                          {lead.aiSummary}
                        </p>
                        {lead.scoreReason && <p className="mt-1.5 text-xs text-slate-600">Puntaje: {lead.scoreReason}</p>}
                      </>
                    ) : (
                      <p className="text-sm text-slate-500">
                        {lead.messages.length ? "Aún sin resumen." : "Se genera cuando haya conversación."}
                      </p>
                    )}
                    {lead.messages.length > 0 && (
                      <RefreshInsightsForm leadId={lead.id} hasSummary={Boolean(lead.aiSummary)} />
                    )}
                  </section>

                  <Section title="Etapa">
                    <form action={moveStageAction.bind(null, lead.id)} className="flex gap-2">
                      <select key={lead.stageId} name="stageId" aria-label="Etapa" defaultValue={lead.stageId} className={inputClass}>
                        {stages.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                      <SubmitButton toast="Etapa actualizada" variant="secondary">Mover</SubmitButton>
                    </form>
                  </Section>

                  <Section title="Ejecutivo">
                    {user.role === "ADMIN" ? (
                      <form action={setAssigneeAction.bind(null, lead.id)} className="flex gap-2">
                        <select
                          key={lead.assigneeId ?? "none"}
                          name="assigneeId"
                          aria-label="Ejecutivo"
                          defaultValue={lead.assigneeId ?? ""}
                          className={inputClass}
                        >
                          <option value="">Sin asignar</option>
                          {executives.map((e) => (
                            <option key={e.id} value={e.id}>
                              {e.name}
                            </option>
                          ))}
                        </select>
                        <SubmitButton toast="Lead asignado" variant="secondary">Asignar</SubmitButton>
                      </form>
                    ) : (
                      <p className="flex items-center gap-2 text-sm text-slate-800">
                        {lead.assignee && <Avatar name={lead.assignee.name} size="sm" />}
                        {lead.assignee?.name ?? "Sin asignar"}
                      </p>
                    )}
                  </Section>

                  {followUps.enabled && isOpen && lead.aiEnabled && (
                    <Section title="Seguimiento">
                      <p className="text-sm text-slate-800">
                        {lead.followUpAt
                          ? formatChileDateTime(lead.followUpAt)
                          : "Sin seguimiento programado"}
                      </p>
                      {lead.followUpAt && (
                        <p className="mt-0.5 text-xs text-slate-600">
                          {lead.followUpReason
                            ? `Agendado por la IA: ${lead.followUpReason}`
                            : `Seguimiento ${lead.followUpCount + 1} de ${followUps.delays.length} si no responde`}
                        </p>
                      )}
                      <div className="mt-3 flex gap-2">
                        <FollowUpNowButton leadId={lead.id} />
                        {lead.followUpAt && (
                          <form action={cancelFollowUpAction.bind(null, lead.id)}>
                            <SubmitButton toast="Seguimiento cancelado" variant="ghost">Cancelar</SubmitButton>
                          </form>
                        )}
                      </div>
                    </Section>
                  )}

                  <Section title="Etiquetas">
                    <div className="mb-3 flex flex-wrap gap-1.5">
                      {lead.contact.tags.length === 0 && <span className="text-sm text-slate-500">Sin etiquetas</span>}
                      {lead.contact.tags.map((ct) => (
                        <form key={ct.tagId} action={removeTagAction.bind(null, lead.id, ct.tagId)} className="inline">
                          <button aria-label={`Quitar etiqueta ${ct.tag.category}: ${ct.tag.name}`} className="group rounded-full">
                            <TagPill label={`${ct.tag.category}: ${ct.tag.name}`} color={ct.tag.color} removable />
                          </button>
                        </form>
                      ))}
                    </div>
                    <form action={addTagAction.bind(null, lead.id)} className="flex gap-2">
                      <select name="tagId" required aria-label="Agregar etiqueta" className={inputClass} defaultValue="">
                        <option value="" disabled>
                          Agregar etiqueta…
                        </option>
                        {tags
                          .filter((t) => !ownTagIds.has(t.id))
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.category}: {t.name}
                            </option>
                          ))}
                      </select>
                      <SubmitButton toast="Etiqueta agregada" variant="secondary">Agregar</SubmitButton>
                    </form>
                  </Section>

                </Card>
              ),
            },
            {
              id: "datos",
              label: "Datos",
              panel: (
                <Card className="divide-y divide-slate-100">
                  <Section title="Datos del cliente">
                    {fields.length ? (
                      <LeadFieldsForm
                        leadId={lead.id}
                        fields={fields.map((f) => ({
                          id: f.id,
                          name: f.name,
                          options: f.type === "OPTIONS" ? f.options : null,
                          value: f.values[0] ? displayFieldValue(f, f.values[0].value) : "",
                          byAi: f.values[0]?.updatedBy === "AI",
                        }))}
                      />
                    ) : (
                      <p className="text-sm text-slate-500">
                        Sin campos configurados.
                        {user.role === "ADMIN" && (
                          <>
                            {" "}
                            <Link href="/settings/fields" className="font-medium text-brand-700 hover:underline">
                              Crear campos
                            </Link>
                          </>
                        )}
                      </p>
                    )}
                  </Section>

                  <Section title="Origen">
                    <LeadOrigin source={lead.source} conversions={lead.conversions} />
                  </Section>

                </Card>
              ),
            },
            {
              id: "tareas",
              label: "Tareas",
              count: pendingTasks.length,
              panel: (
                <Card className="p-4">
                  <h2 className="sr-only">Tareas</h2>
                  {lead.tasks.length === 0 ? (
                    <p className="mb-3 text-sm text-slate-500">Sin tareas.</p>
                  ) : (
                    <ul className="mb-3 divide-y divide-slate-100">
                      {lead.tasks.map((t) => (
                        <TaskItem
                          key={t.id}
                          task={t}
                          now={now}
                          assigneeName={t.assigneeId !== lead.assigneeId ? (t.assignee?.name ?? null) : undefined}
                        />
                      ))}
                    </ul>
                  )}
                  <TaskForm
                    leadId={lead.id}
                    defaultDue={defaultDue}
                    executives={user.role === "ADMIN" ? executives.map((e) => ({ id: e.id, name: e.name })) : undefined}
                    defaultAssigneeId={lead.assigneeId}
                  />
                </Card>

              ),
            },
            {
              id: "historial",
              label: "Historial",
              panel: (
                <Card className="p-4">
                  <h2 className="sr-only">Historial</h2>
                  {lead.events.length === 0 && <p className="text-sm text-slate-500">Sin movimientos todavía.</p>}
                  <ol className="text-xs">
                    {lead.events.map((e, i) => (
                      <li key={e.id} className="relative pb-4 pl-5 last:pb-0">
                        {i < lead.events.length - 1 && <span aria-hidden className="absolute bottom-0 left-[5px] top-3 w-px bg-slate-200" />}
                        <span aria-hidden className="absolute left-0 top-1 size-[11px] rounded-full border-2 border-brand-500 bg-white" />
                        <div className="flex justify-between gap-2">
                          <span className="font-medium text-slate-900">
                            {EVENT_LABEL[e.type] ?? e.type} {describe(e.data as Record<string, unknown>)}
                          </span>
                          <time className="shrink-0 tabular-nums text-slate-500">{time(e.createdAt)}</time>
                        </div>
                        <div className="mt-0.5 text-slate-600">
                          {e.actor === "USER" ? e.user?.name : ACTOR_LABEL[e.actor]}
                          {e.reason && ` · ${e.reason}`}
                        </div>
                      </li>
                    ))}
                  </ol>
                </Card>
              ),
            },
          ]}
        />
      </aside>
    </div>
    </div>
  );
}

type Conversion = { id: string; kind: string; status: string; error: string | null; sentAt: Date | null };

const CONVERSION_LABEL: Record<string, string> = { QUALIFIED: "Lead calificado", PURCHASE: "Venta" };
const CONVERSION_STATUS: Record<string, [label: string, tone: "success" | "warning" | "danger" | "neutral"]> = {
  SENT: ["Enviado", "success"],
  PENDING: ["Por enviar", "neutral"],
  SENDING: ["Enviando", "neutral"],
  FAILED: ["Con error, se reintenta", "danger"],
  SKIPPED: ["No enviado: faltan datos para que Meta reconozca al cliente", "warning"],
};

/** Qué se le avisó a Meta de este lead por la API de Conversiones. */
function LeadConversions({ conversions }: { conversions: Conversion[] }) {
  if (!conversions.length) return null;
  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <p className="mb-1.5 text-xs font-semibold text-slate-600">Avisos a Meta</p>
      <ul className="space-y-1.5">
        {conversions.map((c) => {
          const [label, tone] = CONVERSION_STATUS[c.status] ?? [c.status, "neutral" as const];
          return (
            <li key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-slate-900">{CONVERSION_LABEL[c.kind] ?? c.kind}</span>
              <Badge tone={tone}>{label}</Badge>
              {c.sentAt && <span className="text-xs text-slate-500">{formatLocal(c.sentAt)}</span>}
              {c.status === "FAILED" && c.error && (
                <span className="w-full truncate text-xs text-red-700" title={c.error}>
                  {c.error}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function LeadOrigin({ source: s, conversions }: { source: LeadSource | null; conversions: Conversion[] }) {
  if (!s)
    return (
      <div className="text-sm">
        <p className="text-slate-500">Llegó directo, sin anuncio ni enlace con UTM.</p>
        <LeadConversions conversions={conversions} />
      </div>
    );
  const rows: [string, string | null][] =
    s.kind === "AD"
      ? [
          ["Campaña", s.campaignName],
          ["Conjunto", s.adsetName],
          ["Anuncio", s.adName ?? s.adHeadline],
          ["Id del anuncio", s.adId],
        ]
      : [
          ["Fuente", s.utmSource],
          ["Medio", s.utmMedium],
          ["Campaña", s.utmCampaign],
          ["Contenido", s.utmContent],
          ["Término", s.utmTerm],
        ];
  const link = s.kind === "AD" ? s.adUrl : s.landingUrl;
  return (
    <div className="space-y-2 text-sm">
      <Badge tone="brand">
        <Target aria-hidden />
        {sourceLabel(s)}
      </Badge>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <Fragment key={k}>
              <dt className="text-slate-600">{k}</dt>
              <dd className="truncate text-slate-900" title={v!}>
                {v}
              </dd>
            </Fragment>
          ))}
      </dl>
      {link && /^https?:\/\//.test(link) && (
        <a href={link} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
          <ExternalLink aria-hidden className="size-3.5" />
          {s.kind === "AD" ? "Ver anuncio" : "Ver landing"}
        </a>
      )}
      <LeadConversions conversions={conversions} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="p-4">
      <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-slate-600">{title}</h2>
      {children}
    </section>
  );
}
