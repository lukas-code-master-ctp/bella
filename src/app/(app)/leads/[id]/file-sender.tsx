"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { uploadPresigned } from "@vercel/blob/client";
import { FileText, FolderOpen, Image as ImageIcon, Paperclip, Send, Upload, Video, X } from "lucide-react";
import { Button, FormMessage, inputClass } from "@/components/ui";
import { Callout } from "@/components/settings-ui";
import { toast } from "@/components/toast";
import { leadUploadFolder, META_MAX_BYTES, UPLOAD_MAX_BYTES } from "@/lib/file-limits";
import { libraryFilesAction, sendFilesAction } from "./actions";

type LibraryFile = Awaited<ReturnType<typeof libraryFilesAction>>[number];

/** Tope de archivos de la biblioteca por envío (igual que SEND_MAX_FILES en el servidor). */
const MAX_PICK = 10;
const MB = 1024 * 1024;
const mb = (bytes: number) => `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)} MB`;

/** WhatsApp muestra como foto solo JPEG y PNG, y como video solo MP4 o 3GPP. */
const PHOTO = ["image/jpeg", "image/png"];
const VIDEO = ["video/mp4", "video/3gpp"];

/**
 * Una foto que WhatsApp no aceptaría como foto (más de 5 MB, o en otro formato como WEBP) se
 * achica y se pasa a JPEG en el navegador. Si el navegador no la puede leer (ej. HEIC en Chrome),
 * queda igual y se envía como documento.
 */
async function photoForWhatsApp(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.type === "image/svg+xml") return file;
  if (PHOTO.includes(file.type) && file.size <= META_MAX_BYTES.image) return file;
  try {
    const bitmap = await createImageBitmap(file);
    for (const [side, quality] of [[2560, 0.85], [1920, 0.8], [1280, 0.75]] as const) {
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= META_MAX_BYTES.image) {
        bitmap.close();
        return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
      }
    }
    bitmap.close();
  } catch (err) {
    console.warn("[archivos] no se pudo achicar la foto:", err);
  }
  return file;
}

/** Cómo le llega el archivo al cliente, para avisarlo antes de enviar. */
function arrival(file: File): { icon: React.ReactNode; note: string | null } {
  if (PHOTO.includes(file.type)) return { icon: <ImageIcon aria-hidden />, note: null };
  if (VIDEO.includes(file.type)) {
    return file.size > META_MAX_BYTES.video
      ? { icon: <Video aria-hidden />, note: `Pesa más de ${mb(META_MAX_BYTES.video)}: le llegará como documento. Lo puede abrir igual, pero no se reproduce dentro del chat.` }
      : { icon: <Video aria-hidden />, note: null };
  }
  if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
    return { icon: <FileText aria-hidden />, note: "WhatsApp no muestra este formato dentro del chat: le llegará como documento." };
  }
  return { icon: <FileText aria-hidden />, note: null };
}

/** Clip del chat: abre la ventana para mandar archivos de la biblioteca o del equipo. */
export function FileButton({ leadId, windowClosed, disabled }: { leadId: string; windowClosed: boolean; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="icon"
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-label="Enviar archivos"
        title="Enviar archivos"
      >
        <Paperclip aria-hidden />
      </Button>
      <FileDialog leadId={leadId} windowClosed={windowClosed} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function FileDialog({ leadId, windowClosed, open, onClose }: { leadId: string; windowClosed: boolean; open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby="file-dialog-title"
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl bg-white p-0 shadow-xl backdrop:bg-slate-900/40 open:animate-pop"
    >
      {open && <FileForm leadId={leadId} windowClosed={windowClosed} onClose={onClose} />}
    </dialog>
  );
}

function FileForm({ leadId, windowClosed, onClose }: { leadId: string; windowClosed: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<"library" | "device">("library");
  const [library, setLibrary] = useState<LibraryFile[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    libraryFilesAction(leadId)
      .then((files) => {
        if (!alive) return;
        setLibrary(files);
        if (!files.length) setTab("device");
      })
      .catch(() => alive && setLibrary([]));
    return () => {
      alive = false;
    };
  }, [leadId]);

  const groups = useMemo(() => {
    const map = new Map<string, LibraryFile[]>();
    for (const f of library ?? []) map.set(f.product, [...(map.get(f.product) ?? []), f]);
    // Los archivos sin producto van al final.
    return [...map.entries()].sort(([a], [b]) => Number(!a) - Number(!b));
  }, [library]);

  const toggle = (ids: string[], on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const busy = status !== null;
  const ready = tab === "library" ? picked.size > 0 && picked.size <= MAX_PICK : Boolean(file);

  const send = async () => {
    setError(null);
    try {
      let result: string | null;
      if (tab === "library") {
        setStatus("Enviando…");
        result = await sendFilesAction(leadId, { libraryIds: [...picked], caption });
      } else {
        if (!file) return;
        setStatus("Preparando…");
        const ready = await photoForWhatsApp(file);
        if (ready.size > UPLOAD_MAX_BYTES) {
          setStatus(null);
          return setError(`"${ready.name}" pesa ${mb(ready.size)} y WhatsApp acepta hasta ${mb(UPLOAD_MAX_BYTES)}.`);
        }
        setStatus("Subiendo… 0%");
        const safeName = ready.name.replace(/[^\w.-]+/g, "_") || "archivo";
        const blob = await uploadPresigned(`${leadUploadFolder(leadId)}/${safeName}`, ready, {
          access: "public",
          handleUploadUrl: `/leads/${leadId}/upload`,
          contentType: ready.type || undefined,
          onUploadProgress: ({ percentage }) => setStatus(`Subiendo… ${Math.round(percentage)}%`),
        });
        setStatus("Enviando…");
        result = await sendFilesAction(leadId, {
          upload: { url: blob.url, fileName: ready.name, mimeType: ready.type, size: ready.size },
          caption,
        });
      }
      setStatus(null);
      if (result) return setError(result);
      toast(tab === "library" && picked.size > 1 ? "Archivos enviados" : "Archivo enviado");
      onClose();
    } catch (err) {
      console.error(err);
      setStatus(null);
      setError("No se pudo enviar. Revisa tu conexión e intenta de nuevo.");
    }
  };

  const chosen = file ? arrival(file) : null;

  return (
    <div className="flex max-h-[85dvh] flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <h2 id="file-dialog-title" className="text-base font-semibold text-slate-900">
          Enviar archivos
        </h2>
        <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Cerrar" disabled={busy}>
          <X aria-hidden />
        </Button>
      </div>

      <div className="space-y-4 overflow-y-auto px-5 py-4">
        {windowClosed && (
          <Callout tone="warning" title="Pasaron más de 24 horas desde el último mensaje del cliente">
            El canal no deja mandarle archivos ni mensajes sueltos hasta que vuelva a escribir. Para retomar el contacto hay que usar una plantilla aprobada (un admin la manda desde Envíos masivos).
          </Callout>
        )}

        <div role="tablist" aria-label="Origen del archivo" className="flex w-full rounded-lg bg-slate-100 p-1">
          {(
            [
              ["library", "Biblioteca", <FolderOpen key="i" aria-hidden className="size-4" />],
              ["device", "Subir archivo", <Upload key="i" aria-hidden className="size-4" />],
            ] as const
          ).map(([value, label, icon]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              disabled={busy}
              onClick={() => {
                setTab(value);
                setError(null);
              }}
              className={`flex min-h-8 flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-[color,background-color,box-shadow] duration-150 ${
                tab === value ? "bg-white text-brand-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>

        {tab === "library" ? (
          library === null ? (
            <p className="text-sm text-slate-500">Cargando archivos…</p>
          ) : library.length === 0 ? (
            <p className="text-sm text-slate-600">
              Aún no hay archivos en la biblioteca. Un admin los puede subir en Configuración → Conocimiento → Archivos.
            </p>
          ) : (
            <div className="space-y-3">
              {groups.map(([product, files]) => {
                const ids = files.map((f) => f.id);
                const all = ids.every((id) => picked.has(id));
                return (
                  <fieldset key={product} className="rounded-lg border border-slate-200">
                    <legend className="sr-only">{product || "Sin producto"}</legend>
                    <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
                      <span className="text-sm font-semibold text-slate-800">{product || "Sin producto"}</span>
                      <button
                        type="button"
                        onClick={() => toggle(ids, !all)}
                        className="text-xs font-semibold text-brand-700 hover:text-brand-800"
                      >
                        {all ? "Quitar todos" : `Elegir todos (${ids.length})`}
                      </button>
                    </div>
                    <ul className="divide-y divide-slate-100">
                      {files.map((f) => (
                        <li key={f.id}>
                          <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50">
                            <input
                              type="checkbox"
                              checked={picked.has(f.id)}
                              onChange={(e) => toggle([f.id], e.target.checked)}
                              className="size-4 accent-brand-600"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium text-slate-800">{f.title}</span>
                              <span className="block truncate text-xs text-slate-500">{f.fileName}</span>
                            </span>
                            <a
                              href={f.url}
                              target="_blank"
                              rel="noreferrer"
                              className="shrink-0 text-xs font-medium text-slate-500 hover:text-slate-800"
                            >
                              Ver
                            </a>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </fieldset>
                );
              })}
              {picked.size > MAX_PICK && <FormMessage>Puedes mandar hasta {MAX_PICK} archivos a la vez.</FormMessage>}
            </div>
          )
        ) : (
          <div className="space-y-2">
            <label className="flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border-2 border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-600 hover:border-brand-400 hover:bg-brand-50/40">
              <Upload aria-hidden className="size-5 text-slate-500" />
              <span className="font-medium text-slate-800">{file ? "Cambiar archivo" : "Elige una foto, video o documento"}</span>
              <span className="text-xs">Fotos y documentos hasta {mb(UPLOAD_MAX_BYTES)}. Las fotos grandes se achican solas.</span>
              <input
                type="file"
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setError(null);
                }}
              />
            </label>
            {file && chosen && (
              <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 [&_svg]:size-4 [&_svg]:shrink-0">
                {chosen.icon}
                <span className="min-w-0 flex-1 truncate font-medium">{file.name}</span>
                <span className="shrink-0 text-xs text-slate-500">{mb(file.size)}</span>
              </div>
            )}
            {chosen?.note && <p className="text-xs text-slate-600">{chosen.note}</p>}
          </div>
        )}

        <div>
          <label htmlFor="file-caption" className="mb-1 block text-sm font-medium text-slate-800">
            Mensaje (opcional)
          </label>
          <input
            id="file-caption"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            disabled={busy}
            placeholder="Ej. Te mando el plano del proyecto"
            className={inputClass}
          />
        </div>
        {error && <FormMessage>{error}</FormMessage>}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
        <p className="mr-auto text-xs text-slate-500">Al enviar, tomas la conversación y la IA se pausa.</p>
        <Button type="button" onClick={send} disabled={!ready || busy} aria-busy={busy}>
          <Send aria-hidden />
          {status ?? (tab === "library" && picked.size > 1 ? `Enviar ${picked.size}` : "Enviar")}
        </Button>
      </div>
    </div>
  );
}
