"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Button, FormMessage, inputClass } from "@/components/ui";
import { createLeadAction, newLeadOptionsAction, type NewLeadState } from "./new-lead-actions";

type Options = Awaited<ReturnType<typeof newLeadOptionsAction>>;

/**
 * Botón "Nuevo lead" de la barra superior: crea a mano un cliente que llegó por fuera de los
 * canales (llamada, referido, feria) y abre su ficha. `compact` es el ícono del encabezado móvil.
 */
export function NewLead({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Options | null>(null);
  // La key reinicia el formulario (y su mensaje) cada vez que se abre.
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
    if (open && !options) newLeadOptionsAction().then(setOptions).catch(() => setOptions({ funnels: [], executives: [] }));
  }, [open, options]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setFormKey((k) => k + 1);
          setOpen(true);
        }}
        aria-label={compact ? "Nuevo lead" : undefined}
        className={
          compact
            ? "flex size-10 items-center justify-center rounded-lg text-brand-700 transition-colors duration-150 hover:bg-brand-50"
            : "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-r from-brand-600 to-sky-brand-dark px-3.5 text-sm font-semibold text-white shadow-sm transition-[filter,scale] duration-150 hover:brightness-105 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        }
      >
        <Plus aria-hidden className="size-4" />
        {!compact && "Nuevo lead"}
      </button>
      <dialog
        ref={dialogRef}
        onClose={() => setOpen(false)}
        onClick={(e) => e.target === dialogRef.current && setOpen(false)}
        aria-labelledby="new-lead-title"
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-white p-0 shadow-xl backdrop:bg-slate-900/40 open:animate-pop"
      >
        {open && (
          <NewLeadForm
            key={formKey}
            options={options}
            onClose={() => setOpen(false)}
            onCreated={(leadId) => {
              setOpen(false);
              router.push(`/leads/${leadId}`);
            }}
          />
        )}
      </dialog>
    </>
  );
}

function NewLeadForm({ options, onClose, onCreated }: { options: Options | null; onClose: () => void; onCreated: (leadId: string) => void }) {
  const [state, action, pending] = useActionState<NewLeadState, FormData>(createLeadAction, null);
  const created = state && "leadId" in state ? state : null;

  useEffect(() => {
    if (created && !created.existing) onCreated(created.leadId);
  }, [created, onCreated]);

  return (
    <form
      // Con onSubmit (y no action) el formulario no se vacía si vuelve un error.
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
      className="space-y-3 p-5"
    >
      <div className="mb-1 flex items-start gap-3">
        <div className="flex-1">
          <h2 id="new-lead-title" className="text-base font-semibold text-slate-900">
            Nuevo lead
          </h2>
          <p className="text-sm text-slate-600">Un cliente que llegó por llamada, referido u otra vía.</p>
        </div>
        <button
          type="button"
          aria-label="Cerrar"
          onClick={onClose}
          className="-mr-2 -mt-2 flex size-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        >
          <X aria-hidden className="size-5" />
        </button>
      </div>
      <label className="block text-sm font-medium text-slate-700">
        Nombre
        <input name="name" required autoComplete="off" autoFocus className={`${inputClass} mt-1.5`} />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Teléfono <span className="font-normal text-slate-500">(con código de país)</span>
        <input name="phone" type="tel" inputMode="tel" autoComplete="off" placeholder="+56 9 1234 5678" className={`${inputClass} mt-1.5`} />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Correo
        <input name="email" type="email" autoComplete="off" spellCheck={false} className={`${inputClass} mt-1.5`} />
      </label>
      <p className="text-xs text-slate-600">Basta con el teléfono o el correo.</p>
      {options && options.funnels.length > 1 && (
        <label className="block text-sm font-medium text-slate-700">
          Embudo
          <select name="funnelId" defaultValue="" className={`${inputClass} mt-1.5`}>
            <option value="">El del canal (WhatsApp)</option>
            {options.funnels.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {options && options.executives.length > 0 && (
        <label className="block text-sm font-medium text-slate-700">
          Ejecutivo
          <select name="assigneeId" defaultValue="auto" className={`${inputClass} mt-1.5`}>
            <option value="auto">Según las reglas de asignación</option>
            <option value="">Sin asignar</option>
            {options.executives.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {state && "error" in state && <FormMessage>{state.error}</FormMessage>}
      {created?.existing && (
        <FormMessage tone="neutral">
          Ese contacto ya tiene un lead abierto.{" "}
          <button type="button" onClick={() => onCreated(created.leadId)} className="font-semibold text-brand-700 underline">
            Abrir su ficha
          </button>
        </FormMessage>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" type="button" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          <Plus aria-hidden />
          {pending ? "Creando…" : "Crear lead"}
        </Button>
      </div>
    </form>
  );
}
