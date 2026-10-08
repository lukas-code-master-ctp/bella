import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { Card, inputClass, PageHeader, TagPill } from "@/components/ui";
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

const colorClass = "size-10 shrink-0 rounded-lg border border-slate-300 bg-white p-1";
const checkClass = "size-4 rounded border-slate-300 accent-brand-600";

export default async function FunnelSettingsPage() {
  const [stages, tags, counts] = await Promise.all([
    db.stage.findMany({ orderBy: { position: "asc" } }),
    db.tag.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] }),
    db.lead.groupBy({ by: ["stageId"], _count: { _all: true } }),
  ]);
  const leadsIn = (id: string) => counts.find((c) => c.stageId === id)?._count._all ?? 0;

  return (
    <>
      <PageHeader
        title="Etapas del funnel"
        description="Al entrar a una etapa de atención humana, la IA se pausa y se asigna un ejecutivo automáticamente."
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
