import { Shuffle, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { Badge, Button, Card, CardHeader, EmptyState, Field, inputClass, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { createRuleAction, deleteRuleAction, toggleRuleAction } from "../actions";

export default async function RulesPage() {
  const [rules, stages, tags, executives] = await Promise.all([
    db.assignmentRule.findMany({
      include: { stage: true, tag: true, executives: true },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    }),
    db.stage.findMany({ orderBy: { position: "asc" } }),
    db.tag.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] }),
    db.user.findMany({ where: { role: "EXECUTIVE", active: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <PageHeader
        title="Asignación automática"
        description="Cuando un lead entra a una etapa o recibe una etiqueta, se aplica la primera regla activa que coincida (mayor prioridad primero). Si un lead entra a una etapa de atención humana sin ejecutivo y ninguna regla aplica, se asigna al ejecutivo con menos leads abiertos."
      />
      <Card className="mb-6 divide-y divide-slate-100">
        {rules.length === 0 && (
          <EmptyState icon={<Shuffle />} title="Aún no hay reglas">
            Crea la primera con el formulario de abajo.
          </EmptyState>
        )}
        {rules.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 p-4 text-sm">
            <div className={`min-w-0 flex-1 ${r.active ? "" : "opacity-60"}`}>
              <div className="flex items-center gap-2 font-semibold text-slate-900">
                {r.name}
                {r.active ? <Badge tone="success">Activa</Badge> : <Badge>Inactiva</Badge>}
              </div>
              <div className="mt-0.5 text-slate-600">
                {r.trigger === "STAGE_ENTERED" ? `Entra a etapa "${r.stage?.name}"` : `Recibe etiqueta "${r.tag?.category}: ${r.tag?.name}"`}
                {" → "}
                {r.strategy === "ROUND_ROBIN" ? "rotación" : "menor carga"} entre{" "}
                {r.executives.length ? r.executives.map((e) => e.name).join(", ") : "todos los ejecutivos"}
                {r.reassign && " · reasigna"} · prioridad {r.priority}
              </div>
            </div>
            <form action={toggleRuleAction.bind(null, r.id, !r.active)}>
              <Button variant="secondary">{r.active ? "Desactivar" : "Activar"}</Button>
            </form>
            <form action={deleteRuleAction.bind(null, r.id)}>
              <SubmitButton variant="ghost-danger" size="icon" aria-label={`Borrar regla ${r.name}`} title="Borrar regla" confirm={`¿Borrar la regla "${r.name}"?`} pendingText="">
                <Trash2 aria-hidden />
              </SubmitButton>
            </form>
          </div>
        ))}
      </Card>

      <Card className="p-5">
        <CardHeader title="Nueva regla" />
        <form action={createRuleAction} className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre">
            <input name="name" required placeholder="Ej. Motos a equipo motos" className={inputClass} />
          </Field>
          <Field label="Prioridad" hint="Mayor número se evalúa primero">
            <input name="priority" type="number" defaultValue={0} className={inputClass} />
          </Field>
          <Field label="Cuando el lead entra a la etapa o recibe la etiqueta" hint="La regla se dispara según lo que elijas">
            <select name="target" required className={inputClass}>
              <optgroup label="Entra a la etapa">
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Recibe la etiqueta">
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.category}: {t.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </Field>
          <Field label="Ejecutivos" hint="Sin selección = todos los ejecutivos activos">
            <select name="executives" multiple className={`${inputClass} h-28`}>
              {executives.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="space-y-4">
            <Field label="Estrategia">
              <select name="strategy" className={inputClass}>
                <option value="ROUND_ROBIN">Rotación (round robin)</option>
                <option value="LEAST_LOADED">Menor carga de leads abiertos</option>
              </select>
            </Field>
            <label className="flex min-h-10 items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" name="reassign" className="size-4 rounded border-slate-300 accent-brand-600" /> Reasignar aunque ya tenga ejecutivo
            </label>
          </div>
          <div className="sm:col-span-2">
            <SubmitButton>Crear regla</SubmitButton>
          </div>
        </form>
      </Card>
    </>
  );
}
