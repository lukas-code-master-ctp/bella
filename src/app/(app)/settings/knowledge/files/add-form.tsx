"use client";

import { useRef, useState } from "react";
import { CloudUpload, Plus } from "lucide-react";
import { Field, FormMessage, inputClass } from "@/components/ui";
import { PanelBody, PanelFooter } from "@/components/settings-ui";
import { SubmitButton } from "@/components/submit-button";
import { addFileAction } from "./actions";
import { ProductInput } from "./product-input";

type Status = { tone: "neutral" | "danger"; text: string } | null;

export function AddFileForm({ maxMb, metaLimits, products }: { maxMb: number; metaLimits: string; products: string[] }) {
  const form = useRef<HTMLFormElement>(null);
  const [picked, setPicked] = useState<File[]>([]);
  const [status, setStatus] = useState<Status>(null);
  const [formKey, setFormKey] = useState(0);
  const many = picked.length > 1;

  // Un archivo por llamada: Vercel no acepta cuerpos de más de 4,5 MB, así varios suman sin problema.
  async function upload(fd: FormData) {
    const files = fd.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
    const base = new FormData();
    for (const key of ["title", "product", "description", "url"]) base.set(key, String(fd.get(key) ?? ""));
    if (files.length > 1) base.set("title", "");
    const failed: string[] = [];
    let done = 0;
    for (const file of files.length ? files : [null]) {
      if (files.length > 1) setStatus({ tone: "neutral", text: `Subiendo ${done + failed.length + 1} de ${files.length}…` });
      const one = new FormData();
      base.forEach((v, k) => one.set(k, v));
      if (file) one.set("file", file);
      // Lo que pasa del tope ni llega al servidor (Vercel lo rechaza antes): se avisa aquí.
      const error =
        file && file.size > maxMb * 1024 * 1024
          ? `El archivo pesa más de ${maxMb} MB: súbelo a otro sitio y pega el enlace.`
          : await addFileAction(one).catch(() => "No se pudo subir. Intenta de nuevo.");
      if (error) failed.push(files.length > 1 && file ? `${file.name}: ${error}` : error);
      else done++;
    }
    if (failed.length) {
      setStatus({ tone: "danger", text: (done ? `Se agregaron ${done}. ` : "") + failed.join(" · ") });
      return;
    }
    form.current?.reset();
    setPicked([]);
    setFormKey((k) => k + 1);
    setStatus({ tone: "neutral", text: done > 1 ? `${done} archivos agregados.` : "Archivo agregado." });
  }

  return (
    <form ref={form} action={upload}>
      <PanelBody>
        <label className="relative flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center transition-colors duration-150 hover:border-brand-400 hover:bg-brand-50/40 has-[:focus-visible]:border-brand-500 has-[:focus-visible]:bg-brand-50/40">
          <CloudUpload aria-hidden className="size-7 text-brand-600" />
          <span className="text-sm font-semibold text-slate-900">
            {picked.length === 0 ? "Elige o arrastra uno o varios archivos" : many ? `${picked.length} archivos elegidos` : picked[0].name}
          </span>
          <span className="text-xs text-slate-600">
            {many
              ? picked.map((f) => f.name).join(", ")
              : `PDF, imagen JPG o PNG, video MP4 u otro documento (KMZ, KML…), hasta ${maxMb} MB cada uno`}
          </span>
          <input
            name="file"
            type="file"
            multiple
            aria-label="Archivos"
            onChange={(e) => setPicked(Array.from(e.target.files ?? []))}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Producto o grupo" hint="Ej. el proyecto al que pertenecen. La IA puede mandar uno o todos los del grupo">
            <ProductInput key={formKey} products={products} />
          </Field>
          <Field
            label={many ? "Nombre" : "Nombre (opcional)"}
            hint={
              many ? "Con varios archivos se usa el nombre de cada uno" : "Así lo nombra la IA al enviarlo. Vacío: el nombre del archivo"
            }
          >
            <input name="title" disabled={many} placeholder="Ej. Masterplan" className={inputClass} />
          </Field>
        </div>
        <Field
          label="O un enlace público"
          hint={`Para archivos pesados: enlace directo que empiece con https://. WhatsApp acepta hasta ${metaLimits}`}
        >
          <input name="url" type="url" disabled={picked.length > 0} placeholder="https://…/masterplan.pdf" className={inputClass} />
        </Field>
        <Field label="Cuándo enviarlo" hint="Le explica a la IA qué contienen y en qué momento mandarlos">
          <textarea
            name="description"
            rows={3}
            placeholder="Ej. Fotos del terreno. Envíalas cuando el cliente pida ver el proyecto o pregunte cómo es."
            className={inputClass}
          />
        </Field>
      </PanelBody>
      <PanelFooter note={status && <FormMessage tone={status.tone}>{status.text}</FormMessage>}>
        <SubmitButton pendingText="Subiendo…">
          <Plus aria-hidden />
          {many ? `Agregar ${picked.length} archivos` : "Agregar archivo"}
        </SubmitButton>
      </PanelFooter>
    </form>
  );
}
