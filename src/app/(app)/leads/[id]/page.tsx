import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Bot, BotOff, CircleX, ListTodo, RotateCcw, Sparkles, Trophy } from "lucide-react";
import { canAccessLead, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { displayFieldValue } from "@/lib/domain/fields";
import { CHANNEL_LABEL } from "@/lib/labels";
import { startOfLocalDay, toLocalInput } from "@/lib/dates";
import { markLeadNotificationsRead } from "@/lib/domain/notifications";
import { Avatar, Badge, Button, Card, inputClass, TagPill } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { LinkPending } from "@/components/link-pending";
import { ScoreBadge } from "@/components/score-badge";
import {
  addTagAction,
  moveStageAction,
  removeTagAction,
  reopenLeadAction,
  setAssigneeAction,
  toggleAiAction,
} from "./actions";
import { CloseLeadForm, LeadChat, RefreshInsightsForm } from "./client";
import { LeadFieldsForm } from "./fields-form";
import { TaskForm } from "../../tasks/task-form";
import { TaskItem } from "../../tasks/task-item";

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
  TASK_CREATED: "Tarea creada:",
  TASK_DONE: "Tarea cumplida:",
  TASK_REOPENED: "Tarea pendiente otra vez:",
  TASK_DELETED: "Tarea eliminada:",
};

const ACTOR_LABEL = { AI: "IA", USER: "", SYSTEM: "Sistema" } as const;

function describe(data: Record<string, unknown>) {
  if (data.field) return `${data.field}: ${data.value ?? "borrado"}`;
  if (data.from && data.to) return `${data.from} → ${data.to}`;
  if (data.tag) return String(data.tag);
  if (data.name || data.email) return [data.name, data.email].filter(Boolean).join(" · ");
  if (data.title) return String(data.title);
  if (data.assigneeName) return String(data.assigneeName);
  if (typeof data.amount === "number") return `$${data.amount.toLocaleString("es-CL")}`;
  return "";
}

const time = (d: Date) =>
  d.toLocaleString("es-CL", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const lead = await db.lead.findUnique({
    where: { id },
    include: {
      contact: { include: { tags: { include: { tag: true } } } },
      stage: true,
      assignee: true,
      messages: { include: { user: true }, orderBy: { createdAt: "asc" } },
      events: { include: { user: true }, orderBy: { createdAt: "desc" } },
      tasks: { include: { assignee: true }, orderBy: [{ completedAt: { sort: "desc", nulls: "first" } }, { dueAt: "asc" }] },
    },
  });
  if (!lead || !canAccessLead(user, lead)) notFound();

  const [stages, tags, executives, fields] = await Promise.all([
    db.stage.findMany({ orderBy: { position: "asc" } }),
    db.tag.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] }),
    user.role === "ADMIN" ? db.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }) : [],
    db.customField.findMany({
      orderBy: { position: "asc" },
      include: { values: { where: { contactId: lead.contactId } } },
    }),
    markLeadNotificationsRead(user.id, lead.id),
  ]);
  const ownTagIds = new Set(lead.contact.tags.map((t) => t.tagId));
  const isOpen = lead.status === "OPEN";
  const now = new Date();
  // Mañana a las 10:00 (Chile) como vencimiento sugerido.
  const defaultDue = toLocalInput(new Date(startOfLocalDay(now, 1).getTime() + 10 * 3_600_000));
  const pendingTasks = lead.tasks.filter((t) => !t.completedAt);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card className="flex h-[calc(100dvh-9rem)] min-h-[32rem] flex-col overflow-hidden lg:h-[calc(100dvh-4rem)]">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-3 py-3 sm:px-4">
          <Link
            href="/funnel"
            aria-label="Volver al funnel"
            className="relative flex size-10 items-center justify-center rounded-lg text-slate-500 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-900"
          >
            <ArrowLeft aria-hidden className="size-5" />
            <LinkPending className="mx-1.5" />
          </Link>
          <Avatar name={lead.contact.name} size="lg" />
          <div className="min-w-0">
            <h1 className="truncate font-semibold text-slate-900">{lead.contact.name}</h1>
            <p className="text-xs text-slate-600">
              {lead.contact.phone ?? CHANNEL_LABEL[lead.contact.channel]} · {lead.stage.name}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
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
            {lead.aiEnabled ? (
              <Badge tone="success">
                <Bot aria-hidden />
                IA respondiendo
              </Badge>
            ) : (
              <Badge>
                <BotOff aria-hidden />
                IA pausada
              </Badge>
            )}
          </div>
        </div>

        <LeadChat
          leadId={lead.id}
          contactName={lead.contact.name}
          userName={user.name}
          simulator={lead.contact.channel === "SIMULATOR"}
          messages={lead.messages.map((m) => ({
            id: m.id,
            author: m.author,
            authorName:
              m.author === "CONTACT" ? lead.contact.name : m.author === "AI" ? "Asistente IA" : (m.user?.name ?? "Ejecutivo"),
            body: m.body,
            ...(m.mediaUrl ? { audio: { url: m.mediaUrl, transcript: m.transcript } } : {}),
            time: time(m.createdAt),
          }))}
        />
      </Card>

      <aside className="space-y-4">
        <Card className="divide-y divide-slate-100">
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
                    {s.name}
                  </option>
                ))}
              </select>
              <SubmitButton variant="secondary">Mover</SubmitButton>
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
                <SubmitButton variant="secondary">Asignar</SubmitButton>
              </form>
            ) : (
              <p className="flex items-center gap-2 text-sm text-slate-800">
                {lead.assignee && <Avatar name={lead.assignee.name} size="sm" />}
                {lead.assignee?.name ?? "Sin asignar"}
              </p>
            )}
          </Section>

          <Section title="Asistente IA">
            <form action={toggleAiAction.bind(null, lead.id, !lead.aiEnabled)}>
              <SubmitButton variant="secondary" className="w-full" disabled={!isOpen}>
                {lead.aiEnabled ? <BotOff aria-hidden /> : <Bot aria-hidden />}
                {lead.aiEnabled ? "Pausar IA y tomar la conversación" : "Reactivar IA"}
              </SubmitButton>
            </form>
          </Section>

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
              <select name="tagId" aria-label="Agregar etiqueta" className={inputClass} defaultValue="">
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
              <SubmitButton variant="secondary">Agregar</SubmitButton>
            </form>
          </Section>

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

          <Section title="Resultado">
            {isOpen ? (
              <CloseLeadForm leadId={lead.id} />
            ) : (
              <div className="space-y-3">
                <p className={`flex items-center gap-2 text-sm font-semibold ${lead.status === "WON" ? "text-emerald-700" : "text-rose-700"}`}>
                  {lead.status === "WON" ? <Trophy aria-hidden className="size-4" /> : <CircleX aria-hidden className="size-4" />}
                  {lead.status === "WON"
                    ? `Ganado${lead.amount ? ` · $${lead.amount.toLocaleString("es-CL")}` : ""}`
                    : `Perdido · ${lead.lostReason}`}
                </p>
                <form action={reopenLeadAction.bind(null, lead.id)}>
                  <Button variant="secondary" className="w-full">
                    <RotateCcw aria-hidden />
                    Reabrir
                  </Button>
                </form>
              </div>
            )}
          </Section>
        </Card>

        <Card className="p-4">
          <h2 className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
            <ListTodo aria-hidden className="size-4" />
            Tareas
            {pendingTasks.length > 0 && <span className="normal-case tracking-normal text-slate-500">· {pendingTasks.length} pendientes</span>}
          </h2>
          {lead.tasks.length === 0 ? (
            <p className="mb-3 text-sm text-slate-500">Sin tareas.</p>
          ) : (
            <ul className="mb-3 max-h-80 divide-y divide-slate-100 overflow-y-auto">
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

        <Card className="p-4">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-slate-600">Historial</h2>
          <ol className="max-h-96 overflow-y-auto text-xs">
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
      </aside>
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
