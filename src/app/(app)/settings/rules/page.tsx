import Link from "next/link";
import { ArrowRight, PauseCircle, Pencil, Plus, Save, Shuffle, Trash2, UserRoundCog } from "lucide-react";
import { AI_TASK_TARGET, LEAD_TAKERS, TEMPLATE_REPLY_TARGET } from "@/lib/domain/assignment";
import { stageOptions } from "@/lib/domain/funnels";
import { db } from "@/lib/db";
import { Avatar, Badge, Card, EmptyState, Field, inputClass, PageHeader } from "@/components/ui";
import { Callout, FieldGroup, Panel, PanelBody, PanelFooter, SwitchSubmit, ToggleRow } from "@/components/settings-ui";
import { SubmitButton } from "@/components/submit-button";
import { ExecutivesAndStrategy } from "./executives-strategy";
import { deleteRuleAction, saveRuleAction, toggleRuleAction } from "../actions";

export default async function RulesPage({ searchParams }: { searchParams: Promise<{ editar?: string }> }) {
  const { editar } = await searchParams;
  const [rules, stages, tags, executives] = await Promise.all([
    db.assignmentRule.findMany({
      include: { stage: true, tag: true, executives: true },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    }),
    stageOptions(),
    db.tag.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] }),
    db.user.findMany({ where: LEAD_TAKERS, orderBy: { name: "asc" } }),
  ]);
  const editing = rules.find((r) => r.id === editar) ?? null;
  const target = editing
    ? editing.trigger === "TEMPLATE_REPLY"
      ? TEMPLATE_REPLY_TARGET
      : editing.trigger === "AI_TASK"
        ? AI_TASK_TARGET
        : (editing.stageId ?? editing.tagId ?? "")
    : undefined;
  const chosen = new Set(editing?.executives.map((e) => e.id));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Asignación automática"
        description="Cuando un lead entra a una etapa, recibe una etiqueta, responde tocando un botón de una plantilla de WhatsApp o la IA le deja una tarea, se aplica la primera regla activa que coincida (mayor prioridad primero). Si un lead entra a una etapa de atención humana sin ejecutivo y ninguna regla aplica, se asigna al ejecutivo con menos leads abiertos."
      />

      {executives.length === 0 && (
        <Callout tone="warning" title="No hay a quién asignar leads" className="animate-rise">
          No hay ejecutivos activos ni admins que atiendan leads, así que las reglas no pueden asignar y los leads quedan sin
          ejecutivo. Crea un ejecutivo o activa &quot;Atiende leads&quot; a un admin en <Link href="/settings/users" className="font-medium text-brand-700 underline">Usuarios</Link>.
        </Callout>
      )}

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
                <Link
                  href={`/settings/rules?editar=${r.id}#regla`}
                  aria-label={`Editar regla ${r.name}`}
                  title="Editar regla"
                  className="flex size-10 items-center justify-center rounded-lg text-slate-600 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-900 [&_svg]:size-4"
                >
                  <Pencil aria-hidden />
                </Link>
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
                      : r.trigger === "AI_TASK"
                        ? "La IA deja una tarea"
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

      <Panel
        id="regla"
        key={editing?.id ?? "nueva"}
        icon={editing ? <Pencil /> : <Plus />}
        title={editing ? `Editar regla "${editing.name}"` : "Nueva regla"}
        description="Define cuándo se dispara, entre quiénes se reparte y cómo."
      >
        <form action={saveRuleAction} className="group/rule">
          {editing && <input type="hidden" name="id" value={editing.id} />}
          <PanelBody>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <Field label="Nombre">
                <input name="name" required defaultValue={editing?.name} placeholder="Ej. Motos a equipo motos" className={inputClass} />
              </Field>
              <Field label="Prioridad" hint="Mayor número se evalúa primero">
                <input name="priority" type="number" defaultValue={editing?.priority ?? 0} className={inputClass} />
              </Field>
            </div>
            <div className="grid gap-4 group-has-[option[value=template-reply]:checked]/rule:sm:grid-cols-2">
              <Field label="Cuándo se aplica">
                <select name="target" required defaultValue={target} className={inputClass}>
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
                  <optgroup label="Tareas">
                    <option value={AI_TASK_TARGET}>La IA deja una tarea</option>
                  </optgroup>
                </select>
              </Field>
              {/* Solo aplica a "Toca un botón de la plantilla": se muestra al elegirlo. */}
              <div className="hidden group-has-[option[value=template-reply]:checked]/rule:block">
                <Field label="Texto del botón" hint="Vacío = cualquier botón de la plantilla">
                  <input name="buttonText" defaultValue={editing?.buttonText ?? ""} placeholder="Ej. Quiero que me llamen" className={inputClass} />
                </Field>
              </div>
            </div>
            <ExecutivesAndStrategy
              executives={executives.map((e) => ({ id: e.id, name: e.name }))}
              chosen={[...chosen]}
              strategy={editing?.strategy ?? "ROUND_ROBIN"}
            />
            <FieldGroup title="Qué más ocurre">
              <div className="grid gap-3 sm:grid-cols-2">
                <ToggleRow name="reassign" defaultChecked={editing?.reassign} icon={<UserRoundCog />} title="Reasignar" description="Cambia el ejecutivo aunque el lead ya tenga uno." />
                <div className="hidden group-has-[option[value=template-reply]:checked]/rule:block">
                  <ToggleRow name="pauseAi" defaultChecked={editing?.pauseAi ?? true} icon={<PauseCircle />} title="Pausar la IA" description="Para que siga el ejecutivo después de que el cliente toque el botón." className="h-full" />
                </div>
              </div>
            </FieldGroup>
          </PanelBody>
          <PanelFooter>
            {editing && (
              <Link href="/settings/rules" className="inline-flex min-h-10 items-center rounded-lg px-4 text-sm font-medium text-slate-700 hover:bg-slate-100">
                Cancelar
              </Link>
            )}
            <SubmitButton toast={editing ? "Regla guardada" : "Regla creada"}>
              {editing ? <Save aria-hidden /> : <Plus aria-hidden />}
              {editing ? "Guardar cambios" : "Crear regla"}
            </SubmitButton>
          </PanelFooter>
        </form>
      </Panel>
    </div>
  );
}
