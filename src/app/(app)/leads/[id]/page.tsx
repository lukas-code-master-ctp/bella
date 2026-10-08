import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Bot, BotOff, CircleX, MessageCircle, RotateCcw, Send, Trophy } from "lucide-react";
import { canAccessLead, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { CHANNEL_LABEL } from "@/lib/labels";
import { Avatar, Badge, Button, Card, EmptyState, inputClass, TagPill } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import {
  addTagAction,
  moveStageAction,
  removeTagAction,
  reopenLeadAction,
  sendAsUserAction,
  setAssigneeAction,
  toggleAiAction,
} from "./actions";
import { CloseLeadForm, ContactComposer, ScrollToBottom } from "./client";

const EVENT_LABEL: Record<string, string> = {
  CREATED: "Lead creado",
  STAGE_CHANGED: "Cambio de etapa",
  TAG_ADDED: "Etiqueta agregada",
  TAG_REMOVED: "Etiqueta quitada",
  CONTACT_UPDATED: "Datos del contacto",
  ASSIGNED: "Asignado",
  UNASSIGNED: "Sin asignar",
  HANDOFF: "Derivado a humano",
  AI_PAUSED: "IA pausada",
  AI_RESUMED: "IA reactivada",
  WON: "Ganado",
  LOST: "Perdido",
  REOPENED: "Reabierto",
};

const ACTOR_LABEL = { AI: "IA", USER: "", SYSTEM: "Sistema" } as const;

function describe(data: Record<string, unknown>) {
  if (data.from && data.to) return `${data.from} → ${data.to}`;
  if (data.tag) return String(data.tag);
  if (data.name || data.email) return [data.name, data.email].filter(Boolean).join(" · ");
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
    },
  });
  if (!lead || !canAccessLead(user, lead)) notFound();

  const [stages, tags, executives] = await Promise.all([
    db.stage.findMany({ orderBy: { position: "asc" } }),
    db.tag.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] }),
    user.role === "ADMIN" ? db.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }) : [],
  ]);
  const ownTagIds = new Set(lead.contact.tags.map((t) => t.tagId));
  const isOpen = lead.status === "OPEN";

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card className="flex h-[calc(100dvh-9rem)] min-h-[32rem] flex-col overflow-hidden lg:h-[calc(100dvh-4rem)]">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-3 py-3 sm:px-4">
          <Link
            href="/funnel"
            aria-label="Volver al funnel"
            className="flex size-10 items-center justify-center rounded-lg text-slate-500 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-900"
          >
            <ArrowLeft aria-hidden className="size-5" />
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

        <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 px-3 py-4 sm:px-6" aria-live="polite">
          {lead.messages.length === 0 && (
            <EmptyState icon={<MessageCircle />} title="Aún no hay mensajes">
              Cuando el cliente escriba, la conversación aparecerá aquí.
            </EmptyState>
          )}
          {lead.messages.map((m) => {
            const fromContact = m.author === "CONTACT";
            const author = fromContact ? lead.contact.name : m.author === "AI" ? "Asistente IA" : (m.user?.name ?? "Ejecutivo");
            return (
              <div key={m.id} className={`flex ${fromContact ? "justify-start" : "justify-end"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-xs sm:max-w-[70%] ${
                    fromContact
                      ? "rounded-bl-md border border-slate-200 bg-white text-slate-800"
                      : m.author === "AI"
                        ? "rounded-br-md bg-brand-600 text-white"
                        : "rounded-br-md bg-emerald-700 text-white"
                  }`}
                >
                  <p className={`mb-0.5 flex items-center gap-1 text-[11px] font-semibold ${fromContact ? "text-slate-600" : "text-white/85"}`}>
                    {m.author === "AI" && <Bot aria-hidden className="size-3.5" />}
                    {author}
                  </p>
                  <p className="whitespace-pre-wrap">{m.body}</p>
                  <p className={`mt-1 text-right text-[11px] tabular-nums ${fromContact ? "text-slate-500" : "text-white/80"}`}>
                    {time(m.createdAt)}
                  </p>
                </div>
              </div>
            );
          })}
          <ScrollToBottom dep={lead.messages.length} />
        </div>

        <div className="space-y-3 border-t border-slate-200 bg-white p-3 sm:p-4">
          {lead.contact.channel === "SIMULATOR" && <ContactComposer leadId={lead.id} />}
          <form action={sendAsUserAction.bind(null, lead.id)} className="flex gap-2">
            <label htmlFor="reply" className="sr-only">
              Responder como ejecutivo
            </label>
            <input id="reply" name="body" required placeholder="Responder como ejecutivo (pausa la IA)" className={inputClass} />
            <SubmitButton pendingText="Enviando…">
              <Send aria-hidden />
              <span className="hidden sm:inline">Enviar</span>
            </SubmitButton>
          </form>
        </div>
      </Card>

      <aside className="space-y-4">
        <Card className="divide-y divide-slate-100">
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
