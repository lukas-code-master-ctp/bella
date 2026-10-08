import { db } from "@/lib/db";
import { Button, Card, Field, inputClass, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { deleteDocAction, saveDocAction } from "../actions";

export default async function KnowledgePage() {
  const docs = await db.knowledgeDoc.findMany({ orderBy: { title: "asc" } });
  return (
    <>
      <PageHeader title="Base de conocimiento" />
      <p className="mb-4 text-sm text-slate-600">
        Textos que la asistente consulta para responder: preguntas frecuentes, financiamiento, garantías, horarios,
        sucursales, despacho. Un documento por tema funciona mejor que uno gigante.
      </p>
      <div className="space-y-4">
        {docs.map((d) => (
          <Card key={d.id} className="p-4">
            <form action={saveDocAction} className="space-y-3">
              <input type="hidden" name="id" value={d.id} />
              <input name="title" defaultValue={d.title} className={`${inputClass} font-medium`} />
              <textarea name="content" rows={5} defaultValue={d.content} className={inputClass} />
              <div className="flex gap-2">
                <SubmitButton variant="secondary">Guardar</SubmitButton>
                <Button variant="ghost" formAction={deleteDocAction.bind(null, d.id)}>
                  Borrar
                </Button>
              </div>
            </form>
          </Card>
        ))}
        <Card className="p-4">
          <h2 className="mb-3 font-medium">Nuevo documento</h2>
          <form action={saveDocAction} className="space-y-3">
            <Field label="Título">
              <input name="title" required placeholder="Ej. Financiamiento" className={inputClass} />
            </Field>
            <Field label="Contenido">
              <textarea name="content" required rows={6} className={inputClass} />
            </Field>
            <SubmitButton>Agregar</SubmitButton>
          </form>
        </Card>
      </div>
    </>
  );
}
