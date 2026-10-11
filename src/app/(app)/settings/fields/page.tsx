import { ChevronDown, ChevronUp, ClipboardList, Hash, IdCard, List, Plus, Trash2, Type } from "lucide-react";
import type { FieldType } from "@prisma/client";
import { db } from "@/lib/db";
import { FIELD_TYPE_LABEL } from "@/lib/labels";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { Disclosure, Panel, PanelBody, reorderButtonClass } from "@/components/settings-ui";
import { SubmitButton } from "@/components/submit-button";
import { deleteFieldAction, moveFieldAction } from "./actions";
import { FieldForm } from "./form";

const TYPE_ICON: Record<FieldType, React.ReactNode> = { TEXT: <Type />, NUMBER: <Hash />, OPTIONS: <List />, RUT: <IdCard /> };

export default async function FieldsSettingsPage() {
  const fields = await db.customField.findMany({
    orderBy: { position: "asc" },
    include: { _count: { select: { values: true } } },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campos del cliente"
        description="Datos que la IA completa durante la conversación (RUT, presupuesto, región de interés…). Se ven y se editan en la ficha de cada lead."
      />
      {fields.length === 0 ? (
        <Card className="animate-rise">
          <EmptyState icon={<ClipboardList />} title="Aún no hay campos">
            Agrega abajo el primero, por ejemplo el presupuesto o la comuna de interés.
          </EmptyState>
        </Card>
      ) : (
        <ol className="stagger space-y-3">
          {fields.map((f, i) => (
            <li key={f.id} className="flex items-start gap-2">
              <div className="flex flex-col items-center pt-3">
                <form action={moveFieldAction.bind(null, f.id, -1)}>
                  <button disabled={i === 0} aria-label={`Subir ${f.name}`} className={reorderButtonClass}>
                    <ChevronUp aria-hidden className="size-4" />
                  </button>
                </form>
                <form action={moveFieldAction.bind(null, f.id, 1)}>
                  <button disabled={i === fields.length - 1} aria-label={`Bajar ${f.name}`} className={reorderButtonClass}>
                    <ChevronDown aria-hidden className="size-4" />
                  </button>
                </form>
              </div>
              <div className="min-w-0 flex-1">
                <Disclosure
                  icon={TYPE_ICON[f.type]}
                  summary={
                    <>
                      <p className="flex items-center gap-2 truncate text-sm font-semibold text-slate-900">
                        {f.name}
                        <Badge>{FIELD_TYPE_LABEL[f.type]}</Badge>
                      </p>
                      <p className="truncate text-xs text-slate-500">{f.description || "Sin indicación para la IA"}</p>
                    </>
                  }
                  aside={
                    <span className="hidden text-xs tabular-nums text-slate-500 sm:block">
                      {f._count.values === 1 ? "1 contacto" : `${f._count.values} contactos`} con dato
                    </span>
                  }
                >
                  <FieldForm field={f} />
                  <form action={deleteFieldAction.bind(null, f.id)} className="mt-3 border-t border-slate-100 pt-3">
                    <SubmitButton
                      variant="ghost-danger"
                      size="sm"
                      confirm={`¿Borrar el campo "${f.name}"? Se pierde el dato en ${f._count.values} contactos.`}
                      pendingText="Borrando…"
                    >
                      <Trash2 aria-hidden />
                      Borrar campo
                    </SubmitButton>
                  </form>
                </Disclosure>
              </div>
            </li>
          ))}
        </ol>
      )}
      <Panel icon={<Plus />} title="Nuevo campo" description="Texto libre, número (montos en pesos), lista de opciones o RUT con dígito verificador.">
        <PanelBody>
          <FieldForm />
        </PanelBody>
      </Panel>
    </div>
  );
}
