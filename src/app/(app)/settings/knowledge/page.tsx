import { BookOpen, FileText, Plus, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { buttonClass, Card, EmptyState, Field, inputClass } from "@/components/ui";
import { Callout, Disclosure, Panel, PanelBody, PanelFooter } from "@/components/settings-ui";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmButton } from "@/components/confirm-button";
import { deleteDocAction, saveDocAction } from "../actions";

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

export default async function KnowledgePage() {
  const docs = await db.knowledgeDoc.findMany({ orderBy: { title: "asc" } });
  return (
    <div className="space-y-6">
      <Callout>
        Textos que la asistente consulta para responder: preguntas frecuentes, financiamiento, garantías, horarios,
        sucursales, despacho. Un documento por tema funciona mejor que uno gigante.
      </Callout>

      {docs.length === 0 ? (
        <Card>
          <EmptyState icon={<BookOpen />} title="Todavía no hay documentos">
            Agrega abajo el primero, por ejemplo las preguntas que más se repiten.
          </EmptyState>
        </Card>
      ) : (
        <div className="stagger space-y-3">
          {docs.map((d) => (
            <Disclosure
              key={d.id}
              icon={<FileText />}
              summary={
                <>
                  <p className="truncate text-sm font-semibold text-slate-900">{d.title}</p>
                  <p className="truncate text-xs text-slate-500">
                    {words(d.content).toLocaleString("es-CL")} palabras · {d.content.slice(0, 120)}
                  </p>
                </>
              }
            >
              <form action={saveDocAction} className="space-y-3">
                <input type="hidden" name="id" value={d.id} />
                <Field label="Título">
                  <input name="title" required defaultValue={d.title} className={inputClass} />
                </Field>
                <Field label="Contenido">
                  <textarea name="content" required rows={8} defaultValue={d.content} className={inputClass} />
                </Field>
                <div className="flex flex-wrap justify-between gap-2">
                  <ConfirmButton
                    message={`¿Borrar el documento "${d.title}"?`}
                    formAction={deleteDocAction.bind(null, d.id)}
                    formNoValidate
                    className={buttonClass("ghost-danger")}
                  >
                    <Trash2 aria-hidden />
                    Borrar
                  </ConfirmButton>
                  <SubmitButton>Guardar cambios</SubmitButton>
                </div>
              </form>
            </Disclosure>
          ))}
        </div>
      )}

      <Panel icon={<Plus />} title="Nuevo documento" description="Escribe como se lo explicarías a una persona nueva del equipo.">
        <form action={saveDocAction}>
          <PanelBody>
            <Field label="Título">
              <input name="title" required placeholder="Ej. Financiamiento" className={inputClass} />
            </Field>
            <Field label="Contenido">
              <textarea name="content" required rows={6} className={inputClass} />
            </Field>
          </PanelBody>
          <PanelFooter>
            <SubmitButton pendingText="Agregando…">
              <Plus aria-hidden />
              Agregar documento
            </SubmitButton>
          </PanelFooter>
        </form>
      </Panel>
    </div>
  );
}
