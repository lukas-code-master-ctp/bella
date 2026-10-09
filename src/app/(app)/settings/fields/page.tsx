import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { FIELD_TYPE_LABEL } from "@/lib/labels";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { deleteFieldAction, moveFieldAction } from "./actions";
import { FieldForm } from "./form";

const arrowClass =
  "flex h-6 w-8 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30";

export default async function FieldsSettingsPage() {
  const fields = await db.customField.findMany({
    orderBy: { position: "asc" },
    include: { _count: { select: { values: true } } },
  });

  return (
    <>
      <PageHeader
        title="Campos del cliente"
        description="Datos que la IA completa durante la conversación (RUT, presupuesto, región de interés…). Se ven y se editan en la ficha de cada lead."
      />
      <div className="space-y-4">
        {fields.map((f, i) => (
          <Card key={f.id} className="flex gap-3 p-4">
            <div className="flex flex-col">
              <form action={moveFieldAction.bind(null, f.id, -1)}>
                <button disabled={i === 0} aria-label={`Subir ${f.name}`} className={arrowClass}>
                  <ChevronUp aria-hidden className="size-4" />
                </button>
              </form>
              <form action={moveFieldAction.bind(null, f.id, 1)}>
                <button disabled={i === fields.length - 1} aria-label={`Bajar ${f.name}`} className={arrowClass}>
                  <ChevronDown aria-hidden className="size-4" />
                </button>
              </form>
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-3 flex items-center gap-2">
                <h2 className="font-semibold text-slate-900">{f.name}</h2>
                <Badge>{FIELD_TYPE_LABEL[f.type]}</Badge>
                <span className="text-xs tabular-nums text-slate-600">{f._count.values === 1 ? "1 contacto" : `${f._count.values} contactos`} con dato</span>
                <form action={deleteFieldAction.bind(null, f.id)} className="ml-auto">
                  <SubmitButton
                    variant="ghost-danger"
                    size="icon"
                    aria-label={`Borrar ${f.name}`}
                    title="Borrar campo"
                    confirm={`¿Borrar el campo "${f.name}"? Se pierde el dato en ${f._count.values} contactos.`}
                    pendingText=""
                  >
                    <Trash2 aria-hidden />
                  </SubmitButton>
                </form>
              </div>
              <FieldForm field={f} />
            </div>
          </Card>
        ))}
        <Card className="p-4">
          <CardHeader title="Nuevo campo" description="Texto libre, número (montos en pesos), lista de opciones o RUT con dígito verificador." />
          <FieldForm />
        </Card>
      </div>
    </>
  );
}
