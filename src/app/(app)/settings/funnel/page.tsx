import { ChevronDown, ChevronUp, Plus, Settings2, SquareKanban, Tags, Trash2, UserRound } from "lucide-react";
import Link from "next/link";
import { db } from "@/lib/db";
import { ensureDefaultFunnel, listFunnels, primaryFunnelId } from "@/lib/domain/funnels";
import { getAssistantSettings } from "@/lib/settings";
import { Badge, Card, EmptyState, inputClass, PageHeader, TagPill } from "@/components/ui";
import { colorInputClass, InlineSwitch, Panel, PanelBody, reorderButtonClass } from "@/components/settings-ui";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmButton } from "@/components/confirm-button";
import {
  createStageAction,
  createTagAction,
  deleteStageAction,
  deleteTagAction,
  moveStagePositionAction,
  updateStageAction,
} from "../actions";
import { FunnelForm, NewFunnelForm } from "./funnel-forms";

export default async function FunnelSettingsPage({ searchParams }: { searchParams: Promise<{ funnel?: string }> }) {
  const { funnel: selected } = await searchParams;
  const { id: primaryId } = await ensureDefaultFunnel(db);
  const [funnels, tags, counts, assistant] = await Promise.all([
    listFunnels(),
    db.tag.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] }),
    db.lead.groupBy({ by: ["stageId"], _count: { _all: true } }),
    getAssistantSettings(),
  ]);
  const funnel = funnels.find((f) => f.id === selected) ?? funnels[0];
  const stages = await db.stage.findMany({ where: { funnelId: funnel.id }, orderBy: { position: "asc" } });
  const leadsIn = (id: string) => counts.find((c) => c.stageId === id)?._count._all ?? 0;
  const categories = [...new Set(tags.map((t) => t.category))];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Embudos"
        description="Cada línea de negocio puede tener su embudo, con sus etapas, los canales que entran a él y su propia asistente."
      />

      <Card className="animate-rise space-y-4 p-4">
        <nav aria-label="Embudos" className="flex flex-wrap gap-2">
          {funnels.map((f) => {
            const active = f.id === funnel.id;
            return (
              <Link
                key={f.id}
                href={`/settings/funnel?funnel=${f.id}`}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-3.5 text-sm font-semibold transition-colors duration-150 [&_svg]:size-4 ${
                  active
                    ? "border-brand-500 bg-brand-50 text-brand-800 shadow-[0_0_0_1px_var(--color-brand-500)]"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                <SquareKanban aria-hidden className={active ? "text-brand-600" : "text-slate-400"} />
                {f.name}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-slate-100 pt-4">
          <NewFunnelForm />
        </div>
      </Card>

      <Panel icon={<Settings2 />} title={`Ajustes de ${funnel.name}`} description="Canales, asistente e instrucciones propias de este embudo.">
        <FunnelForm key={funnel.id} funnel={funnel} defaultAssistant={assistant.assistantName} removable={funnel.id !== primaryId} />
      </Panel>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{funnels.length > 1 ? `Etapas de ${funnel.name}` : "Etapas del funnel"}</h2>
          <p className="mt-0.5 max-w-2xl text-sm text-slate-600">
            En las etapas que atiende la IA, escribe cuándo debe mover al lead y a qué etapa; si no nombras otra, avanza a la
            siguiente. Al entrar a una etapa de atención humana, la IA se pausa y se asigna un ejecutivo automáticamente.
          </p>
        </div>
        <ol className="stagger space-y-3">
          {stages.map((s, i) => (
            <li
              key={s.id}
              className="flex gap-3 rounded-xl border border-l-4 border-slate-200 bg-white p-4 shadow-xs"
              style={{ borderLeftColor: s.color }}
            >
              <div className="flex flex-col items-center">
                <form action={moveStagePositionAction.bind(null, s.id, -1)}>
                  <button disabled={i === 0} aria-label={`Subir ${s.name}`} className={reorderButtonClass}>
                    <ChevronUp aria-hidden className="size-4" />
                  </button>
                </form>
                <span className="text-xs font-semibold tabular-nums text-slate-400">{i + 1}</span>
                <form action={moveStagePositionAction.bind(null, s.id, 1)}>
                  <button disabled={i === stages.length - 1} aria-label={`Bajar ${s.name}`} className={reorderButtonClass}>
                    <ChevronDown aria-hidden className="size-4" />
                  </button>
                </form>
              </div>
              <form action={updateStageAction.bind(null, s.id)} className="group/stage min-w-0 flex-1 space-y-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <input type="color" name="color" aria-label="Color" defaultValue={s.color} className={colorInputClass} />
                  <input name="name" aria-label="Nombre de la etapa" defaultValue={s.name} className={`${inputClass} min-w-40 flex-1 font-semibold sm:max-w-xs`} />
                  <InlineSwitch name="requiresHuman" defaultChecked={s.requiresHuman} label="Atención humana" />
                  <span className="ml-auto flex items-center gap-2">
                    <Badge tone={leadsIn(s.id) ? "brand" : "neutral"}>
                      {leadsIn(s.id)} {leadsIn(s.id) === 1 ? "lead" : "leads"}
                    </Badge>
                    <SubmitButton toast="Etapa guardada" variant="secondary" size="sm">
                      Guardar
                    </SubmitButton>
                  </span>
                </div>
                {/* Se muestran los dos campos y el switch elige cuál se ve, sin esperar a guardar. */}
                <div className="hidden space-y-2 group-has-[input[name=requiresHuman]:checked]/stage:block">
                  <p className="flex items-center gap-1.5 text-xs text-slate-600">
                    <UserRound aria-hidden className="size-3.5" />
                    La IA se pausa y un ejecutivo toma la conversación.
                  </p>
                  <label className="block text-sm text-slate-700">
                    <span className="mb-1 block text-xs font-medium text-slate-600">Cuándo la IA deriva un lead a esta etapa</span>
                    <textarea
                      name="entryCriteria"
                      rows={3}
                      defaultValue={s.entryCriteria ?? ""}
                      placeholder="Ej.: cuando quiera visitar o reservar, pida un descuento o tenga un reclamo. Vale desde cualquier etapa. Vacío: deriva si el cliente pide una persona, quiere comprar, está molesto o pregunta algo que la IA no sabe."
                      className={inputClass}
                    />
                  </label>
                </div>
                <label className="block text-sm text-slate-700 group-has-[input[name=requiresHuman]:checked]/stage:hidden">
                  <span className="mb-1 block text-xs font-medium text-slate-600">Cuándo la IA saca al lead de esta etapa</span>
                  <textarea
                    name="exitCriteria"
                    rows={2}
                    defaultValue={s.exitCriteria ?? ""}
                    placeholder={
                      stages[i + 1]
                        ? `Ej.: cuando el cliente entregue su nombre y diga para qué lo quiere, mover a "${stages[i + 1].name}". Si pide hablar con alguien, derivar a un ejecutivo.`
                        : "Ej.: cuando el cliente pida hablar con alguien, derivar a un ejecutivo."
                    }
                    className={inputClass}
                  />
                </label>
              </form>
              <form action={deleteStageAction.bind(null, s.id)} className="self-start">
                <SubmitButton toast="Etapa borrada"
                  variant="ghost-danger"
                  size="icon"
                  disabled={leadsIn(s.id) > 0}
                  aria-label={`Borrar ${s.name}`}
                  title={leadsIn(s.id) > 0 ? "Solo se pueden borrar etapas vacías" : "Borrar etapa"}
                  confirm={`¿Borrar la etapa "${s.name}"?`}
                  pendingText=""
                >
                  <Trash2 aria-hidden />
                </SubmitButton>
              </form>
            </li>
          ))}
        </ol>
        <form
          action={createStageAction}
          className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-dashed border-slate-300 bg-white/60 p-4 transition-colors duration-150 focus-within:border-brand-400 hover:border-slate-400"
        >
          <input type="hidden" name="funnelId" value={funnel.id} />
          <input type="color" name="color" aria-label="Color" defaultValue="#64748b" className={colorInputClass} />
          <input name="name" required aria-label="Nueva etapa" placeholder="Nueva etapa" className={`${inputClass} min-w-40 flex-1 sm:max-w-xs`} />
          <InlineSwitch name="requiresHuman" label="Atención humana" />
          <SubmitButton toast="Etapa agregada" className="ml-auto">
            <Plus aria-hidden />
            Agregar etapa
          </SubmitButton>
        </form>
      </section>

      <Panel icon={<Tags />} title="Etiquetas" description="Un contacto tiene como máximo una etiqueta por categoría. La IA usa este catálogo para etiquetar.">
        <PanelBody>
          {categories.length === 0 ? (
            <EmptyState icon={<Tags />} title="Aún no hay etiquetas" />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {categories.map((cat) => (
                <div key={cat} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{cat}</p>
                  <div className="flex flex-wrap gap-2">
                    {tags
                      .filter((t) => t.category === cat)
                      .map((t) => (
                        <form key={t.id} action={deleteTagAction.bind(null, t.id)}>
                          <ConfirmButton
                            message={`¿Borrar la etiqueta "${t.category}: ${t.name}"?`}
                            aria-label={`Borrar etiqueta ${t.category}: ${t.name}`}
                            title="Borrar etiqueta"
                            className="group rounded-full transition-[scale] duration-150 active:scale-95"
                          >
                            <TagPill label={t.name} color={t.color} removable />
                          </ConfirmButton>
                        </form>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <form action={createTagAction} className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            <input type="color" name="color" aria-label="Color" defaultValue="#0ea5e9" className={colorInputClass} />
            <input name="category" required aria-label="Categoría" placeholder="Categoría (ej. Producto)" list="tag-categories" className={`${inputClass} sm:max-w-[200px]`} />
            <datalist id="tag-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <input name="name" required aria-label="Etiqueta" placeholder="Etiqueta (ej. Motos)" className={`${inputClass} sm:max-w-[200px]`} />
            <SubmitButton toast="Etiqueta agregada">
              <Plus aria-hidden />
              Agregar
            </SubmitButton>
          </form>
        </PanelBody>
      </Panel>
    </div>
  );
}
