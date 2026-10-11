"use client";

import { useActionState, useRef, useState } from "react";
import { CloudUpload, Plus } from "lucide-react";
import { Field, FormMessage, inputClass } from "@/components/ui";
import { PanelBody, PanelFooter } from "@/components/settings-ui";
import { SubmitButton } from "@/components/submit-button";
import { addFileAction } from "./actions";

export function AddFileForm({ maxMb }: { maxMb: number }) {
  const form = useRef<HTMLFormElement>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [message, action] = useActionState(async (prev: string | null, fd: FormData) => {
    const result = await addFileAction(prev, fd);
    if (result === "Archivo agregado.") {
      form.current?.reset();
      setPicked(null);
    }
    return result;
  }, null);
  return (
    <form ref={form} action={action}>
      <PanelBody>
        <label className="relative flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center transition-colors duration-150 hover:border-brand-400 hover:bg-brand-50/40 has-[:focus-visible]:border-brand-500 has-[:focus-visible]:bg-brand-50/40">
          <CloudUpload aria-hidden className="size-7 text-brand-600" />
          <span className="text-sm font-semibold text-slate-900">{picked ?? "Elige o arrastra un archivo"}</span>
          <span className="text-xs text-slate-600">PDF, imagen JPG o PNG, video MP4 u otro documento, hasta {maxMb} MB</span>
          <input
            name="file"
            type="file"
            aria-label="Archivo"
            accept=".pdf,.jpg,.jpeg,.png,.mp4,.doc,.docx,.xls,.xlsx,.ppt,.pptx,image/jpeg,image/png,video/mp4,application/pdf"
            onChange={(e) => setPicked(e.target.files?.[0]?.name ?? null)}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre" hint="Así lo nombra la IA al enviarlo">
            <input name="title" required placeholder="Ej. Masterplan del proyecto" className={inputClass} />
          </Field>
          <Field label="O un enlace público" hint="Para archivos pesados: enlace directo que empiece con https://">
            <input name="url" type="url" placeholder="https://…/masterplan.pdf" className={inputClass} />
          </Field>
        </div>
        <Field label="Cuándo enviarlo" hint="Le explica a la IA qué contiene y en qué momento mandarlo">
          <textarea
            name="description"
            rows={3}
            placeholder="Ej. Plano con los lotes y precios. Envíalo cuando el cliente pregunte por el proyecto o pida el plano."
            className={inputClass}
          />
        </Field>
      </PanelBody>
      <PanelFooter note={message && <FormMessage tone={message === "Archivo agregado." ? "neutral" : "danger"}>{message}</FormMessage>}>
        <SubmitButton pendingText="Subiendo…">
          <Plus aria-hidden />
          Agregar archivo
        </SubmitButton>
      </PanelFooter>
    </form>
  );
}
