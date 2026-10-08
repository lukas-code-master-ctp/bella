import { Plus, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { Card, CardHeader, Field, inputClass, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmButton } from "@/components/confirm-button";
import { buttonClass } from "@/components/ui";
import { deleteDocAction, saveDocAction } from "../actions";

export default async function KnowledgePage() {
  const docs = await db.knowledgeDoc.findMany({ orderBy: { title: "asc" } });
  return (
    <>
      <PageHeader
        title="Base de conocimiento"
        description="Textos que la asistente consulta para responder: preguntas frecuentes, financiamiento, garantías, horarios, sucursales, despacho. Un documento por tema funciona mejor que uno gigante."
      />
      <div className="space-y-4">
        {docs.map((d) => (
          <Card key={d.id} className="p-4">
            <form action={saveDocAction} className="space-y-3">
              <input type="hidden" name="id" value={d.id} />
              <input name="title" aria-label="Título" defaultValue={d.title} className={`${inputClass} font-semibold`} />
              <textarea name="content" aria-label="Contenido" rows={5} defaultValue={d.content} className={inputClass} />
              <div className="flex gap-2">
                <SubmitButton variant="secondary">Guardar</SubmitButton>
                <ConfirmButton
                  message={`¿Borrar el documento "${d.title}"?`}
                  formAction={deleteDocAction.bind(null, d.id)}
                  className={buttonClass("ghost-danger")}
                >
                  <Trash2 aria-hidden />
                  Borrar
                </ConfirmButton>
              </div>
            </form>
          </Card>
        ))}
        <Card className="p-4">
          <CardHeader title="Nuevo documento" />
          <form action={saveDocAction} className="space-y-3">
            <Field label="Título">
              <input name="title" required placeholder="Ej. Financiamiento" className={inputClass} />
            </Field>
            <Field label="Contenido">
              <textarea name="content" required rows={6} className={inputClass} />
            </Field>
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
