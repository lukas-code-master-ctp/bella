import { db } from "@/lib/db";
import { Button, Card, inputClass, PageHeader, TagPill } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import {
  createStageAction,
  createTagAction,
  deleteStageAction,
  deleteTagAction,
  moveStagePositionAction,
  updateStageAction,
} from "../actions";

export default async function FunnelSettingsPage() {
  const [stages, tags, counts] = await Promise.all([
    db.stage.findMany({ orderBy: { position: "asc" } }),
    db.tag.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] }),
    db.lead.groupBy({ by: ["stageId"], _count: { _all: true } }),
  ]);
  const leadsIn = (id: string) => counts.find((c) => c.stageId === id)?._count._all ?? 0;

  return (
    <>
      <PageHeader title="Etapas del funnel" />
      <Card className="divide-y divide-slate-100">
        {stages.map((s, i) => (
          <div key={s.id} className="flex flex-wrap items-center gap-2 p-3">
            <div className="flex flex-col">
              <form action={moveStagePositionAction.bind(null, s.id, -1)}>
                <button disabled={i === 0} className="px-1 text-xs text-slate-400 hover:text-slate-700 disabled:opacity-30">▲</button>
              </form>
              <form action={moveStagePositionAction.bind(null, s.id, 1)}>
                <button disabled={i === stages.length - 1} className="px-1 text-xs text-slate-400 hover:text-slate-700 disabled:opacity-30">▼</button>
              </form>
            </div>
            <form action={updateStageAction.bind(null, s.id)} className="flex flex-1 flex-wrap items-center gap-2">
              <input type="color" name="color" defaultValue={s.color} className="h-9 w-9 rounded border border-slate-300" />
              <input name="name" defaultValue={s.name} className={`${inputClass} max-w-xs`} />
              <label className="flex items-center gap-1 text-sm text-slate-600">
                <input type="checkbox" name="requiresHuman" defaultChecked={s.requiresHuman} /> Atención humana
              </label>
              <SubmitButton variant="secondary">Guardar</SubmitButton>
            </form>
            <span className="text-xs text-slate-400">{leadsIn(s.id)} leads</span>
            <form action={deleteStageAction.bind(null, s.id)}>
              <Button variant="ghost" disabled={leadsIn(s.id) > 0} title="Solo se pueden borrar etapas vacías">
                Borrar
              </Button>
            </form>
          </div>
        ))}
        <form action={createStageAction} className="flex flex-wrap items-center gap-2 bg-slate-50 p-3">
          <input type="color" name="color" defaultValue="#64748b" className="h-9 w-9 rounded border border-slate-300" />
          <input name="name" required placeholder="Nueva etapa" className={`${inputClass} max-w-xs`} />
          <label className="flex items-center gap-1 text-sm text-slate-600">
            <input type="checkbox" name="requiresHuman" /> Atención humana
          </label>
          <SubmitButton>Agregar</SubmitButton>
        </form>
      </Card>
      <p className="mt-2 text-xs text-slate-500">
        Al entrar a una etapa de atención humana, la IA se pausa y se asigna un ejecutivo automáticamente.
      </p>

      <div className="mt-10">
        <PageHeader title="Etiquetas" />
        <Card className="p-4">
          <div className="mb-4 flex flex-wrap gap-2">
            {tags.length === 0 && <span className="text-sm text-slate-500">Aún no hay etiquetas.</span>}
            {tags.map((t) => (
              <form key={t.id} action={deleteTagAction.bind(null, t.id)}>
                <button title="Borrar etiqueta">
                  <TagPill label={`${t.category}: ${t.name} ×`} color={t.color} />
                </button>
              </form>
            ))}
          </div>
          <form action={createTagAction} className="flex flex-wrap items-center gap-2">
            <input type="color" name="color" defaultValue="#0ea5e9" className="h-9 w-9 rounded border border-slate-300" />
            <input name="category" required placeholder="Categoría (ej. Producto)" className={`${inputClass} max-w-[200px]`} />
            <input name="name" required placeholder="Etiqueta (ej. Motos)" className={`${inputClass} max-w-[200px]`} />
            <SubmitButton>Agregar</SubmitButton>
          </form>
          <p className="mt-2 text-xs text-slate-500">
            Un contacto tiene como máximo una etiqueta por categoría. La IA usa este catálogo para etiquetar.
          </p>
        </Card>
      </div>
    </>
  );
}
