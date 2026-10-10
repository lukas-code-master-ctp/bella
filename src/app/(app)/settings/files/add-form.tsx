"use client";

import { useActionState, useRef } from "react";
import { Plus } from "lucide-react";
import { Field, FormMessage, inputClass } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { addFileAction } from "./actions";

export function AddFileForm({ maxMb }: { maxMb: number }) {
  const form = useRef<HTMLFormElement>(null);
  const [message, action] = useActionState(async (prev: string | null, fd: FormData) => {
    const result = await addFileAction(prev, fd);
    if (result === "Archivo agregado.") form.current?.reset();
    return result;
  }, null);
  return (
    <form ref={form} action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nombre" hint="Así lo nombra la IA al enviarlo">
          <input name="title" required placeholder="Ej. Masterplan del proyecto" className={inputClass} />
        </Field>
        <Field label="Archivo" hint={`PDF, imagen JPG o PNG, video MP4 u otro documento, hasta ${maxMb} MB`}>
          <input
            name="file"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.mp4,.doc,.docx,.xls,.xlsx,.ppt,.pptx,image/jpeg,image/png,video/mp4,application/pdf"
            className={`${inputClass} file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-2 file:py-1 file:text-sm file:font-medium file:text-brand-700`}
          />
        </Field>
      </div>
      <Field label="O un enlace público" hint="Para archivos más pesados: un enlace directo al archivo que empiece con https://">
        <input name="url" type="url" placeholder="https://…/masterplan.pdf" className={inputClass} />
      </Field>
      <Field label="Cuándo enviarlo" hint="Le explica a la IA qué contiene y en qué momento mandarlo">
        <textarea
          name="description"
          rows={3}
          placeholder="Ej. Plano con los lotes y precios. Envíalo cuando el cliente pregunte por el proyecto o pida el plano."
          className={inputClass}
        />
      </Field>
      <div className="flex items-center gap-3">
        <SubmitButton pendingText="Subiendo…">
          <Plus aria-hidden />
          Agregar
        </SubmitButton>
        {message && <FormMessage tone={message === "Archivo agregado." ? "neutral" : "danger"}>{message}</FormMessage>}
      </div>
    </form>
  );
}
