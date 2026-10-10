import { ExternalLink, FileText, Film, Image as ImageIcon, Paperclip, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { fileKind } from "@/lib/media";
import { FILE_MAX_BYTES, kindLabel } from "@/lib/domain/files";
import { Badge, buttonClass, Card, CardHeader, EmptyState, inputClass, PageHeader } from "@/components/ui";
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
    <>
      <PageHeader
        title="Archivos para la IA"
        description="Documentos, imágenes y videos que la asistente puede enviarle al cliente por el chat: planos, fichas técnicas, catálogos, fotos. La descripción le indica cuándo mandar cada uno."
      />
      <Card className="mb-6">
        {files.length === 0 ? (
          <EmptyState icon={<Paperclip />} title="Todavía no hay archivos">
            Agrega abajo el primero, por ejemplo el plano o el catálogo que más piden los clientes.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {files.map((f) => (
              <li key={f.id} className="p-4">
                <form action={updateFileAction.bind(null, f.id)} className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 [&_svg]:size-4">
                      {ICONS[fileKind(f.mimeType)]}
                    </span>
                    <input name="title" aria-label="Nombre" defaultValue={f.title} className={`${inputClass} min-w-0 flex-1 font-semibold`} />
                    <Badge>
                      {kindLabel(f.mimeType)} · {formatSize(f.size)}
                    </Badge>
                    <a href={f.url} target="_blank" rel="noreferrer" className={buttonClass("ghost", "icon")} title="Abrir el archivo">
                      <ExternalLink aria-hidden />
                      <span className="sr-only">Abrir {f.fileName}</span>
                    </a>
                  </div>
                  <textarea
                    name="description"
                    aria-label="Cuándo enviarlo"
                    rows={2}
                    defaultValue={f.description}
                    placeholder="Cuándo enviarlo"
                    className={inputClass}
                  />
                  <div className="flex gap-2">
                    <SubmitButton variant="secondary">Guardar</SubmitButton>
                    <ConfirmButton
                      message={`¿Quitar "${f.title}"? La IA ya no podrá enviarlo; los envíos anteriores quedan en las conversaciones.`}
                      formAction={deleteFileAction.bind(null, f.id)}
                      className={buttonClass("ghost-danger")}
                    >
                      <Trash2 aria-hidden />
                      Quitar
                    </ConfirmButton>
                  </div>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="p-4">
        <CardHeader title="Nuevo archivo" />
        <AddFileForm maxMb={FILE_MAX_BYTES / 1024 / 1024} />
      </Card>
    </>
  );
}
