import { ArrowRight, Gauge, PauseCircle, Plus, Repeat, Shuffle, Trash2, UserRoundCog } from "lucide-react";
import { TEMPLATE_REPLY_TARGET } from "@/lib/domain/assignment";
import { stageOptions } from "@/lib/domain/funnels";
import { db } from "@/lib/db";
import { Avatar, Badge, Card, EmptyState, Field, inputClass, PageHeader } from "@/components/ui";
import { Chip, ChoiceCard, FieldGroup, Panel, PanelBody, PanelFooter, SwitchSubmit, ToggleRow } from "@/components/settings-ui";
import { SubmitButton } from "@/components/submit-button";
import { createRuleAction, deleteRuleAction, toggleRuleAction } from "../actions";

export default async function RulesPage() {
  const [rules, stages, tags, executives] = await Promise.all([
    db.assignmentRule.findMany({
      include: { stage: true, tag: true, executives: true },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    }),
    stageOptions(),
    db.tag.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] }),
    db.user.findMany({ where: { role: "EXECUTIVE", active: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Asignación automática"
        description="Cuando un lead entra a una etapa, recibe una etiqueta o responde tocando un botón de una plantilla de WhatsApp, se aplica la primera regla activa que coincida (mayor prioridad primero). Si un lead entra a una etapa de atención humana sin ejecutivo y ninguna regla aplica, se asigna al ejecutivo con menos leads abiertos."
      />

      {rules.length === 0 ? (
        <Card className="animate-rise">
          <EmptyState icon={<Shuffle />} title="Aún no hay reglas">
            Crea la primera con el formulario de abajo.
          </EmptyState>
        </Card>
      ) : (
        <ul className="stagger space-y-3">
          {rules.map((r) => (
            <li key={r.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
              <div className="flex flex-wrap items-center gap-3">
                <form action={toggleRuleAction.bind(null, r.id, !r.active)}>
                  <SwitchSubmit on={r.active} label={r.active ? `Desactivar ${r.name}` : `Activar ${r.name}`} />
                </form>
                <div className={`min-w-0 flex-1 ${r.active ? "" : "opacity-60"}`}>
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                    {r.name}
                    <Badge>Prioridad {r.priority}</Badge>
                  </p>
                </div>
                <form action={deleteRuleAction.bind(null, r.id)}>
                  <SubmitButton toast="Regla borrada" variant="ghost-danger" size="icon" aria-label={`Borrar regla ${r.name}`} title="Borrar regla" confirm={`¿Borrar la regla "${r.name}"?`} pendingText="">
                    <Trash2 aria-hidden />
                  </SubmitButton>
                </form>
              </div>
              <div className={`mt-3 flex flex-wrap items-center gap-2 text-sm ${r.active ? "" : "opacity-60"}`}>
                <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-slate-700">
                  {r.trigger === "STAGE_ENTERED"
                    ? `Entra a "${r.stage?.name}"`
                    : r.trigger === "TAG_ADDED"
                      ? `Recibe "${r.tag?.category}: ${r.tag?.name}"`
                      : r.buttonText
                        ? `Toca el botón "${r.buttonText}"`
                        : "Toca un botón de plantilla"}
                </span>
                <ArrowRight aria-hidden className="size-4 text-slate-400" />
                <span className="rounded-lg bg-brand-50 px-2.5 py-1 font-medium text-brand-800">
                  {r.strategy === "ROUND_ROBIN" ? "Rotación" : "Menor carga"}
                </span>
                <span className="flex items-center gap-1.5 text-slate-600">
                  <span>entre</span>
                  {r.executives.length ? (
                    <span className="flex -space-x-1.5">
                      {r.executives.slice(0, 5).map((e) => (
                        <span key={e.id} title={e.name} className="rounded-full ring-2 ring-white">
                          <Avatar name={e.name} size="sm" />
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span>todos los ejecutivos</span>
                  )}
                  {r.executives.length > 5 && <span className="text-xs">+{r.executives.length - 5}</span>}
                </span>
                {r.reassign && <Badge tone="warning">Reasigna</Badge>}
                {r.pauseAi && <Badge>Pausa la IA</Badge>}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Panel icon={<Plus />} title="Nueva regla" description="Define cuándo se dispara, entre quiénes se reparte y cómo.">
        <form action={createRuleAction}>
          <PanelBody>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <Field label="Nombre">
                <input name="name" required placeholder="Ej. Motos a equipo motos" className={inputClass} />
              </Field>
              <Field label="Prioridad" hint="Mayor número se evalúa primero">
                <input name="priority" type="number" defaultValue={0} className={inputClass} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Cuándo se aplica">
                <select name="target" required className={inputClass}>
                  <optgroup label="Entra a la etapa">
                    {stages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
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
                  <optgroup label="Responde a una plantilla de WhatsApp">
                    <option value={TEMPLATE_REPLY_TARGET}>Toca un botón de la plantilla</option>
                  </optgroup>
                </select>
              </Field>
              <Field label="Texto del botón" hint="Solo para botones de plantilla. Vacío = cualquier botón">
                <input name="buttonText" placeholder="Ej. Quiero que me llamen" className={inputClass} />
              </Field>
            </div>
            <FieldGroup title="Ejecutivos" description="Sin selección, se reparte entre todos los ejecutivos activos.">
              {executives.length === 0 ? (
                <p className="text-sm text-slate-500">No hay ejecutivos activos. Créalos en Usuarios.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {executives.map((e) => (
                    <Chip key={e.id} name="executives" value={e.id}>
                      {e.name}
                    </Chip>
                  ))}
                </div>
              )}
            </FieldGroup>
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium text-slate-800">Estrategia</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <ChoiceCard name="strategy" value="ROUND_ROBIN" defaultChecked icon={<Repeat />} title="Rotación" description="Uno a uno, por turnos (round robin)." />
                <ChoiceCard name="strategy" value="LEAST_LOADED" icon={<Gauge />} title="Menor carga" description="Al que tiene menos leads abiertos." />
              </div>
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2">
              <ToggleRow name="reassign" icon={<UserRoundCog />} title="Reasignar" description="Aunque el lead ya tenga ejecutivo." />
              <ToggleRow name="pauseAi" defaultChecked icon={<PauseCircle />} title="Pausar la IA" description="Para que siga el ejecutivo (botón de plantilla)." />
            </div>
          </PanelBody>
          <PanelFooter>
            <SubmitButton toast="Regla creada">
              <Plus aria-hidden />
              Crear regla
            </SubmitButton>
          </PanelFooter>
        </form>
      </Panel>
    </div>
  );
}
