import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { db } from "@/lib/db";
import { DEFAULT_FUNNEL_ID, ensureDefaultFunnel, listFunnels } from "@/lib/domain/funnels";
import { getAssistantSettings } from "@/lib/settings";
import { buttonClass, Card, inputClass, PageHeader, TagPill } from "@/components/ui";
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

const colorClass = "size-10 shrink-0 rounded-lg border border-slate-300 bg-white p-1";
const checkClass = "size-4 rounded border-slate-300 accent-brand-600";

export default async function FunnelSettingsPage({ searchParams }: { searchParams: Promise<{ funnel?: string }> }) {
  const { funnel: selected } = await searchParams;
  await ensureDefaultFunnel(db);
  const [funnels, tags, counts, assistant] = await Promise.all([
    listFunnels(),
    db.tag.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] }),
    db.lead.groupBy({ by: ["stageId"], _count: { _all: true } }),
    getAssistantSettings(),
  ]);
  const funnel = funnels.find((f) => f.id === selected) ?? funnels[0];
  const stages = await db.stage.findMany({ where: { funnelId: funnel.id }, orderBy: { position: "asc" } });
  const leadsIn = (id: string) => counts.find((c) => c.stageId === id)?._count._all ?? 0;

  return (
    <>
      <PageHeader
        title="Embudos"
        description="Cada línea de negocio puede tener su embudo, con sus etapas, los canales que entran a él y su propia asistente."
      />
      <Card className="mb-6 space-y-4 p-4">
        <nav aria-label="Embudos" className="flex flex-wrap gap-2">
          {funnels.map((f) => (
            <Link
              key={f.id}
              href={`/settings/funnel?funnel=${f.id}`}
              aria-current={f.id === funnel.id ? "page" : undefined}
              className={buttonClass(f.id === funnel.id ? "primary" : "secondary", "sm")}
            >
              {f.name}
            </Link>
          ))}
        </nav>
        <NewFunnelForm />
      </Card>
      <Card className="mb-6 p-5">
        <FunnelForm
          key={funnel.id}
          funnel={funnel}
          defaultAssistant={assistant.assistantName}
          removable={funnel.id !== DEFAULT_FUNNEL_ID}
        />
      </Card>

      <PageHeader
        title={funnels.length > 1 ? `Etapas de ${funnel.name}` : "Etapas del funnel"}
        description="En las etapas que atiende la IA, escribe cuándo debe mover al lead y a qué etapa; si no nombras otra, avanza a la siguiente. Al entrar a una etapa de atención humana, la IA se pausa y se asigna un ejecutivo automáticamente."
      />
      <Card className="divide-y divide-slate-100">
        {stages.map((s, i) => (
          <div key={s.id} className="flex flex-wrap items-center gap-3 p-3">
            <div className="flex flex-col">
              <form action={moveStagePositionAction.bind(null, s.id, -1)}>
                <button
                  disabled={i === 0}
                  aria-label={`Subir ${s.name}`}
                  className="flex h-6 w-8 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30"
                >
                  <ChevronUp aria-hidden className="size-4" />
                </button>
              </form>
              <form action={moveStagePositionAction.bind(null, s.id, 1)}>
                <button
                  disabled={i === stages.length - 1}
                  aria-label={`Bajar ${s.name}`}
                  className="flex h-6 w-8 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30"
                >
                  <ChevronDown aria-hidden className="size-4" />
                </button>
              </form>
            </div>
            <form action={updateStageAction.bind(null, s.id)} className="flex flex-1 flex-wrap items-center gap-2">
              <input type="color" name="color" aria-label="Color" defaultValue={s.color} className={colorClass} />
              <input name="name" aria-label="Nombre de la etapa" defaultValue={s.name} className={`${inputClass} max-w-xs`} />
              <label className="flex min-h-10 items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" name="requiresHuman" defaultChecked={s.requiresHuman} className={checkClass} /> Atención humana
              </label>
              {!s.requiresHuman && (
                <label className="basis-full text-sm text-slate-700">
                  <span className="mb-1 block font-medium">Cuándo la IA saca al lead de esta etapa</span>
                  <textarea
                    name="exitCriteria"
                    rows={3}
                    defaultValue={s.exitCriteria ?? ""}
                    placeholder={
                      stages[i + 1]
                        ? `Ej.: cuando el cliente entregue su nombre y diga para qué lo quiere, mover a "${stages[i + 1].name}". Si pide hablar con alguien, derivar a un ejecutivo.`
                        : "Ej.: cuando el cliente pida hablar con alguien, derivar a un ejecutivo."
                    }
                    className={inputClass}
                  />
                </label>
              )}
              <SubmitButton variant="secondary">Guardar</SubmitButton>
            </form>
            <span className="text-xs tabular-nums text-slate-600">{leadsIn(s.id)} leads</span>
            <form action={deleteStageAction.bind(null, s.id)}>
              <SubmitButton
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
          </div>
        ))}
        <form action={createStageAction} className="flex flex-wrap items-center gap-3 rounded-b-xl bg-slate-50 p-3 pl-14">
          <input type="hidden" name="funnelId" value={funnel.id} />
          <input type="color" name="color" aria-label="Color" defaultValue="#64748b" className={colorClass} />
          <input name="name" required aria-label="Nueva etapa" placeholder="Nueva etapa" className={`${inputClass} max-w-xs`} />
          <label className="flex min-h-10 items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="requiresHuman" className={checkClass} /> Atención humana
          </label>
          <SubmitButton>
            <Plus aria-hidden />
            Agregar
          </SubmitButton>
        </form>
      </Card>

      <div className="mt-10">
        <PageHeader
          title="Etiquetas"
          description="Un contacto tiene como máximo una etiqueta por categoría. La IA usa este catálogo para etiquetar."
        />
        <Card className="p-4">
          <div className="mb-4 flex flex-wrap gap-2">
            {tags.length === 0 && <span className="text-sm text-slate-600">Aún no hay etiquetas.</span>}
            {tags.map((t) => (
              <form key={t.id} action={deleteTagAction.bind(null, t.id)}>
                <ConfirmButton
                  message={`¿Borrar la etiqueta "${t.category}: ${t.name}"?`}
                  aria-label={`Borrar etiqueta ${t.category}: ${t.name}`}
                  className="group rounded-full"
                >
                  <TagPill label={`${t.category}: ${t.name}`} color={t.color} removable />
                </ConfirmButton>
              </form>
            ))}
          </div>
          <form action={createTagAction} className="flex flex-wrap items-center gap-2">
            <input type="color" name="color" aria-label="Color" defaultValue="#0ea5e9" className={colorClass} />
            <input name="category" required aria-label="Categoría" placeholder="Categoría (ej. Producto)" className={`${inputClass} sm:max-w-[200px]`} />
            <input name="name" required aria-label="Etiqueta" placeholder="Etiqueta (ej. Motos)" className={`${inputClass} sm:max-w-[200px]`} />
            <SubmitButton>
              <Plus aria-hidden />
              Agregar
            </SubmitButton>
          </form>
        </Card>
      </div>
    </>
  );
}
