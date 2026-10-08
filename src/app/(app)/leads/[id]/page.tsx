import Link from "next/link";
import { notFound } from "next/navigation";
import { canAccessLead, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { CHANNEL_LABEL } from "@/lib/labels";
import { Button, Card, inputClass, TagPill } from "@/components/ui";
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
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <Card className="flex h-[calc(100vh-8rem)] flex-col">
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <Link href="/funnel" className="text-sm text-slate-500 hover:text-slate-800">
            ← Funnel
          </Link>
          <h1 className="font-semibold">{lead.contact.name}</h1>
          <span className="text-xs text-slate-500">{lead.contact.phone ?? CHANNEL_LABEL[lead.contact.channel]}</span>
          <span
            className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${
              lead.aiEnabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
            }`}
          >
            {lead.aiEnabled ? "IA respondiendo" : "IA pausada"}
          </span>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4">
          {lead.messages.length === 0 && (
            <p className="text-center text-sm text-slate-400">Aún no hay mensajes.</p>
          )}
          {lead.messages.map((m) => {
            const fromContact = m.author === "CONTACT";
            return (
              <div key={m.id} className={`flex ${fromContact ? "justify-start" : "justify-end"}`}>
                <div
                  className={`max-w-[75%] rounded-lg px-3 py-2 text-sm shadow-sm ${
                    fromContact
                      ? "bg-white text-slate-800"
                      : m.author === "AI"
                        ? "bg-brand-600 text-white"
                        : "bg-emerald-600 text-white"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{m.body}</p>
                  <p className={`mt-1 text-[10px] ${fromContact ? "text-slate-400" : "text-white/70"}`}>
                    {fromContact ? lead.contact.name : m.author === "AI" ? "Asistente IA" : m.user?.name} ·{" "}
                    {time(m.createdAt)}
                  </p>
                </div>
              </div>
            );
          })}
          <ScrollToBottom dep={lead.messages.length} />
        </div>

        <div className="space-y-3 border-t border-slate-200 p-4">
          {lead.contact.channel === "SIMULATOR" && <ContactComposer leadId={lead.id} />}
          <form action={sendAsUserAction.bind(null, lead.id)} className="flex gap-2">
            <input name="body" required placeholder="Responder como ejecutivo (pausa la IA)" className={inputClass} />
            <SubmitButton pendingText="Enviando…">Enviar</SubmitButton>
          </form>
        </div>
      </Card>

      <aside className="space-y-4">
        <Card className="space-y-4 p-4">
          <div>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Etapa</h2>
            <form action={moveStageAction.bind(null, lead.id)} className="flex gap-2">
              <select key={lead.stageId} name="stageId" defaultValue={lead.stageId} className={inputClass}>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <SubmitButton variant="secondary">Mover</SubmitButton>
            </form>
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Ejecutivo</h2>
            {user.role === "ADMIN" ? (
              <form action={setAssigneeAction.bind(null, lead.id)} className="flex gap-2">
                <select key={lead.assigneeId ?? "none"} name="assigneeId" defaultValue={lead.assigneeId ?? ""} className={inputClass}>
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
              <p className="text-sm">{lead.assignee?.name ?? "Sin asignar"}</p>
            )}
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Asistente IA</h2>
            <form action={toggleAiAction.bind(null, lead.id, !lead.aiEnabled)}>
              <SubmitButton variant="secondary" className="w-full" disabled={!isOpen}>
                {lead.aiEnabled ? "Pausar IA (tomar conversación)" : "Reactivar IA"}
              </SubmitButton>
            </form>
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Etiquetas</h2>
            <div className="mb-2 flex flex-wrap gap-1">
              {lead.contact.tags.length === 0 && <span className="text-xs text-slate-400">Sin etiquetas</span>}
              {lead.contact.tags.map((ct) => (
                <form key={ct.tagId} action={removeTagAction.bind(null, lead.id, ct.tagId)} className="inline">
                  <button title="Quitar" className="group">
                    <TagPill label={`${ct.tag.category}: ${ct.tag.name} ×`} color={ct.tag.color} />
                  </button>
                </form>
              ))}
            </div>
            <form action={addTagAction.bind(null, lead.id)} className="flex gap-2">
              <select name="tagId" className={inputClass} defaultValue="">
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
              <SubmitButton variant="secondary">+</SubmitButton>
            </form>
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Resultado</h2>
            {isOpen ? (
              <CloseLeadForm leadId={lead.id} />
            ) : (
              <div className="space-y-2">
                <p className={`text-sm font-medium ${lead.status === "WON" ? "text-emerald-700" : "text-rose-700"}`}>
                  {lead.status === "WON"
                    ? `Ganado${lead.amount ? ` · $${lead.amount.toLocaleString("es-CL")}` : ""}`
                    : `Perdido · ${lead.lostReason}`}
                </p>
                <form action={reopenLeadAction.bind(null, lead.id)}>
                  <Button variant="ghost" className="w-full">
                    Reabrir
                  </Button>
                </form>
              </div>
            )}
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Historial</h2>
          <ol className="max-h-80 space-y-3 overflow-y-auto text-xs">
            {lead.events.map((e) => (
              <li key={e.id} className="border-l-2 border-slate-200 pl-3">
                <div className="flex justify-between gap-2">
                  <span className="font-medium text-slate-800">
                    {EVENT_LABEL[e.type] ?? e.type} {describe(e.data as Record<string, unknown>)}
                  </span>
                  <span className="shrink-0 text-slate-400">{time(e.createdAt)}</span>
                </div>
                <div className="text-slate-500">
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
