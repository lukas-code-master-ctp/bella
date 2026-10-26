"use client";

import { useEffect, useRef, useState } from "react";
import { uploadPresigned } from "@vercel/blob/client";
import { ChevronDown, ImagePlus, Upload } from "lucide-react";
import { Dropdown } from "@/components/dropdown";
import { dropdownItemClass } from "@/components/ui";
import { EMAIL_IMAGE_MAX_BYTES, emailImageFolder } from "@/lib/file-limits";
import { emailImagesAction, type EmailImage } from "../actions";

const MB = 1024 * 1024;

/**
 * Botón «Subir imagen»: sube una imagen a la carpeta de correos de la empresa (fuera de la
 * biblioteca de la IA) o elige una ya subida, y entrega su dirección https:// para pegarla.
 */
export function EmailImages({ companyId, onPick, buttonClassName }: { companyId: string; onPick: (url: string) => void; buttonClassName: string }) {
  const [images, setImages] = useState<EmailImage[]>([]);
  const [status, setStatus] = useState<{ tone: "neutral" | "danger"; text: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailImagesAction().then(setImages, () => {});
  }, []);

  async function upload(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setStatus({ tone: "danger", text: "Elige una imagen (JPG, PNG, GIF o WEBP)." });
    if (file.size > EMAIL_IMAGE_MAX_BYTES)
      return setStatus({ tone: "danger", text: `Pesa ${(file.size / MB).toFixed(1)} MB; el máximo es ${EMAIL_IMAGE_MAX_BYTES / MB} MB. Achícala antes de subirla.` });
    setStatus({ tone: "neutral", text: "Subiendo… 0%" });
    try {
      const safeName = file.name.replace(/[^\w.-]+/g, "_") || "imagen";
      const blob = await uploadPresigned(`${emailImageFolder(companyId)}/${safeName}`, file, {
        access: "public",
        handleUploadUrl: "/broadcasts/email/upload",
        contentType: file.type,
        onUploadProgress: ({ percentage }) => setStatus({ tone: "neutral", text: `Subiendo… ${Math.round(percentage)}%` }),
      });
      setImages((list) => [{ url: blob.url, name: file.name }, ...list]);
      setStatus(null);
      onPick(blob.url);
    } catch (err) {
      console.error(err);
      setStatus({ tone: "danger", text: "No se pudo subir la imagen. Revisa tu conexión e intenta de nuevo." });
    }
  }

  return (
    <>
      <Dropdown
        label="Subir imagen"
        align="left"
        width="w-80"
        buttonClassName={buttonClassName}
        button={
          <>
            <ImagePlus aria-hidden className="text-brand-600" />
            Subir imagen
            <ChevronDown aria-hidden className="text-slate-500" />
          </>
        }
      >
        <button type="button" role="menuitem" tabIndex={-1} onClick={() => input.current?.click()} className={dropdownItemClass()}>
          <Upload aria-hidden />
          Subir una imagen nueva…
        </button>
        {images.length > 0 && (
          <>
            <p className="px-3 pb-1 pt-2 text-xs font-semibold text-slate-500">Ya subidas</p>
            <div className="max-h-72 overflow-y-auto">
              {images.map((im) => (
                <button key={im.url} type="button" role="menuitem" tabIndex={-1} onClick={() => onPick(im.url)} className={dropdownItemClass()}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={im.url} alt="" className="size-8 shrink-0 rounded object-cover" />
                  <span className="min-w-0 flex-1 truncate">{im.name}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </Dropdown>
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
      {status && <span className={`text-xs ${status.tone === "danger" ? "text-rose-700" : "text-slate-600"}`}>{status.text}</span>}
    </>
  );
}
