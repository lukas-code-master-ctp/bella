"use client";

import { useEffect, useRef, useState } from "react";
import { uploadPresigned } from "@vercel/blob/client";
import { LoaderCircle, Upload, X } from "lucide-react";
import { Button, FormMessage } from "@/components/ui";
import { EMAIL_IMAGE_MAX_BYTES, emailImageFolder } from "@/lib/file-limits";
import { emailImagesAction, type EmailImage } from "../actions";

const MB = 1024 * 1024;

/**
 * Ventana para elegir la imagen de un correo: una ya cargada en la app (las subidas para correos y
 * las de Conocimiento → Archivos) o una nueva desde el computador. Las nuevas quedan en la carpeta
 * de correos de la empresa, fuera de la biblioteca que usa la IA.
 */
export function ImagePicker({
  open,
  companyId,
  library,
  onPick,
  onClose,
}: {
  open: boolean;
  companyId: string;
  library: { url: string; label: string }[];
  onPick: (url: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [uploaded, setUploaded] = useState<EmailImage[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      ref.current?.showModal();
      setError(null);
      if (!uploaded) emailImagesAction().then(setUploaded, () => setUploaded([]));
    } else ref.current?.close();
  }, [open, uploaded]);

  function pick(url: string) {
    onPick(url);
    onClose();
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("image/")) return setError("Elige una imagen (JPG, PNG, GIF o WEBP).");
    if (file.size > EMAIL_IMAGE_MAX_BYTES)
      return setError(`Pesa ${(file.size / MB).toFixed(1)} MB; el máximo es ${EMAIL_IMAGE_MAX_BYTES / MB} MB. Achícala antes de subirla.`);
    setStatus("Subiendo… 0%");
    try {
      const safeName = file.name.replace(/[^\w.-]+/g, "_") || "imagen";
      const blob = await uploadPresigned(`${emailImageFolder(companyId)}/${safeName}`, file, {
        access: "public",
        handleUploadUrl: "/broadcasts/email/upload",
        contentType: file.type,
        onUploadProgress: ({ percentage }) => setStatus(`Subiendo… ${Math.round(percentage)}%`),
      });
      setUploaded((list) => [{ url: blob.url, name: file.name }, ...(list ?? [])]);
      setStatus(null);
      pick(blob.url);
    } catch (err) {
      console.error(err);
      setStatus(null);
      setError("No se pudo subir la imagen. Revisa tu conexión e intenta de nuevo.");
    }
  }

  const groups = [
    { title: "Subidas para correos", items: (uploaded ?? []).map((im) => ({ url: im.url, label: im.name })) },
    { title: "De Conocimiento → Archivos", items: library },
  ].filter((g) => g.items.length > 0);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby="image-picker-title"
      className="m-auto w-[calc(100%-2rem)] max-w-2xl rounded-2xl bg-white p-0 shadow-xl backdrop:bg-slate-900/40 open:animate-pop"
    >
      <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
        <h2 id="image-picker-title" className="flex-1 text-base font-semibold text-slate-900">
          Elegir imagen
        </h2>
        <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Cerrar">
          <X aria-hidden />
        </Button>
      </div>
      <div className="max-h-[70vh] space-y-5 overflow-y-auto p-5">
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" disabled={Boolean(status)} onClick={() => input.current?.click()}>
            {status ? <LoaderCircle aria-hidden className="animate-spin" /> : <Upload aria-hidden />}
            {status ?? "Subir desde tu computador"}
          </Button>
          <span className="text-xs text-slate-600">JPG, PNG, GIF o WEBP, hasta {EMAIL_IMAGE_MAX_BYTES / MB} MB. La IA no usa estas imágenes.</span>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            aria-label="Imagen para el correo"
            className="hidden"
            onChange={(e) => {
              upload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
        {error && <FormMessage>{error}</FormMessage>}
        {uploaded === null ? (
          <p className="flex items-center gap-2 text-sm text-slate-600">
            <LoaderCircle aria-hidden className="size-4 animate-spin" /> Buscando tus imágenes…
          </p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-slate-600">Todavía no hay imágenes cargadas. Sube la primera desde tu computador.</p>
        ) : (
          groups.map((g) => (
            <section key={g.title} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{g.title}</h3>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {g.items.map((im) => (
                  <li key={im.url}>
                    <button
                      type="button"
                      onClick={() => pick(im.url)}
                      className="group block w-full overflow-hidden rounded-lg border border-slate-200 text-left transition-colors duration-150 hover:border-brand-500 focus-visible:outline-2 focus-visible:outline-brand-600"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={im.url} alt="" loading="lazy" className="aspect-[4/3] w-full bg-slate-100 object-cover" />
                      <span className="block truncate px-2 py-1.5 text-xs text-slate-700 group-hover:text-brand-700">{im.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </dialog>
  );
}
