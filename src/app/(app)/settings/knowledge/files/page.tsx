import { ExternalLink, FileText, Film, Image as ImageIcon, Paperclip, Plus, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { fileKind } from "@/lib/media";
import { FILE_MAX_BYTES, kindLabel } from "@/lib/domain/files";
import { Badge, buttonClass, Card, EmptyState, Field, inputClass } from "@/components/ui";
import { Callout, Disclosure, Panel } from "@/components/settings-ui";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmButton } from "@/components/confirm-button";
import { deleteFileAction, updateFileAction } from "./actions";
import { AddFileForm } from "./add-form";

const ICONS = { image: <ImageIcon aria-hidden />, video: <Film aria-hidden />, document: <FileText aria-hidden />, audio: <FileText aria-hidden /> };

function formatSize(bytes: number | null) {
  if (!bytes) return "enlace";
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default async function FilesPage() {
  const files = await db.mediaFile.findMany({ orderBy: { title: "asc" } });
  return (
    <div className="space-y-6">
      <Callout>
        Documentos, imágenes y videos que la asistente puede enviarle al cliente por el chat: planos, fichas técnicas,
        catálogos, fotos. La descripción le indica cuándo mandar cada uno.
      </Callout>

      {files.length === 0 ? (
        <Card>
          <EmptyState icon={<Paperclip />} title="Todavía no hay archivos">
            Agrega abajo el primero, por ejemplo el plano o el catálogo que más piden los clientes.
          </EmptyState>
        </Card>
      ) : (
        <div className="stagger space-y-3">
          {files.map((f) => (
            <Disclosure
              key={f.id}
              icon={ICONS[fileKind(f.mimeType)]}
              summary={
                <>
                  <p className="truncate text-sm font-semibold text-slate-900">{f.title}</p>
                  <p className="truncate text-xs text-slate-500">{f.description || "Sin indicación de cuándo enviarlo"}</p>
                </>
              }
              aside={
                <Badge className="hidden sm:inline-flex">
                  {kindLabel(f.mimeType)} · {formatSize(f.size)}
                </Badge>
              }
            >
              <form action={updateFileAction.bind(null, f.id)} className="space-y-3">
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <Field label="Nombre">
                      <input name="title" required defaultValue={f.title} className={inputClass} />
                    </Field>
                  </div>
                  <a href={f.url} target="_blank" rel="noreferrer" className={buttonClass("secondary")}>
                    <ExternalLink aria-hidden />
                    Abrir
                    <span className="sr-only"> {f.fileName}</span>
                  </a>
                </div>
                <Field label="Cuándo enviarlo">
                  <textarea name="description" rows={3} defaultValue={f.description} className={inputClass} />
                </Field>
                <div className="flex flex-wrap justify-between gap-2">
                  <ConfirmButton
                    message={`¿Quitar "${f.title}"? La IA ya no podrá enviarlo; los envíos anteriores quedan en las conversaciones.`}
                    formAction={deleteFileAction.bind(null, f.id)}
                    formNoValidate
                    className={buttonClass("ghost-danger")}
                  >
                    <Trash2 aria-hidden />
                    Quitar
                  </ConfirmButton>
                  <SubmitButton>Guardar cambios</SubmitButton>
                </div>
              </form>
            </Disclosure>
          ))}
        </div>
      )}

      <Panel icon={<Plus />} title="Nuevo archivo" description="Súbelo aquí o pega un enlace público si pesa mucho.">
        <AddFileForm maxMb={FILE_MAX_BYTES / 1024 / 1024} />
      </Panel>
    </div>
  );
}
