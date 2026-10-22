"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Ellipsis, Pause, Play, Trash2, X } from "lucide-react";
import { Dropdown } from "@/components/dropdown";
import { dropdownItemClass, Field, FormMessage, inputClass } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { toast } from "@/components/toast";
import { deleteCompanyAction, reactivateCompanyAction, suspendCompanyAction } from "./actions";

type Company = { id: string; name: string; suspended: boolean };

/** Menú ⋯ de una empresa: suspender, reactivar y eliminar (solo si está suspendida). */
export function CompanyMenu({ company, canDelete }: { company: Company; canDelete: boolean }) {
  const [deleting, setDeleting] = useState(false);
  const [pending, start] = useTransition();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (deleting) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [deleting]);

  function suspend() {
    if (
      !window.confirm(
        `¿Suspender ${company.name}? Su equipo no podrá entrar y la IA, los seguimientos, los envíos masivos y los mensajes que lleguen quedan detenidos hasta que la reactives. No se borra nada.`,
      )
    )
      return;
    start(async () => {
      const error = await suspendCompanyAction(company.id);
      toast(error ?? `${company.name} suspendida`, error ? "error" : undefined);
    });
  }

  function reactivate() {
    start(async () => {
      const error = await reactivateCompanyAction(company.id);
      toast(error ?? `${company.name} reactivada`, error ? "error" : undefined);
    });
  }

  return (
    <>
      <Dropdown
        label={`Acciones de ${company.name}`}
        button={<Ellipsis aria-hidden className="size-5" />}
        buttonClassName={`flex size-10 items-center justify-center rounded-lg text-slate-600 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-900 ${pending ? "opacity-60" : ""}`}
        width="w-52"
      >
        {company.suspended ? (
          <button type="button" role="menuitem" tabIndex={-1} onClick={reactivate} className={dropdownItemClass()}>
            <Play aria-hidden />
            Reactivar
          </button>
        ) : (
          <button type="button" role="menuitem" tabIndex={-1} onClick={suspend} className={dropdownItemClass()}>
            <Pause aria-hidden />
            Suspender…
          </button>
        )}
        {company.suspended && canDelete && (
          <>
            <div role="separator" className="my-1 h-px bg-slate-100" />
            <button type="button" role="menuitem" tabIndex={-1} onClick={() => setDeleting(true)} className={dropdownItemClass(true)}>
              <Trash2 aria-hidden />
              Eliminar…
            </button>
          </>
        )}
      </Dropdown>

      <dialog
        ref={dialogRef}
        onClose={() => setDeleting(false)}
        onClick={(e) => e.target === dialogRef.current && setDeleting(false)}
        aria-labelledby={`delete-company-${company.id}`}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-white p-0 shadow-xl backdrop:bg-slate-900/40 open:animate-pop"
      >
        {deleting && (
          <div className="p-5">
            <div className="mb-4 flex items-start gap-3">
              <h2 id={`delete-company-${company.id}`} className="flex-1 text-base font-semibold text-slate-900">
                Eliminar {company.name}
              </h2>
              <button
                type="button"
                aria-label="Cerrar"
                onClick={() => setDeleting(false)}
                className="-mr-2 -mt-2 flex size-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              >
                <X aria-hidden className="size-5" />
              </button>
            </div>
            <DeleteForm company={company} onDone={() => setDeleting(false)} />
          </div>
        )}
      </dialog>
    </>
  );
}

function DeleteForm({ company, onDone }: { company: Company; onDone: () => void }) {
  const [error, action] = useActionState(async (prev: string | null, form: FormData) => {
    const result = await deleteCompanyAction(company.id, prev, form);
    if (!result) {
      toast(`${company.name} eliminada`);
      onDone();
    }
    return result;
  }, null);
  return (
    <form action={action} className="space-y-4">
      <p className="text-sm text-slate-600">
        La empresa deja de aparecer y su equipo pierde el acceso para siempre. Sus leads, chats y configuración quedan guardados en la base,
        pero no se pueden recuperar desde la app.
      </p>
      <Field label={`Escribe «${company.name}» para confirmar`}>
        <input name="confirmName" required autoComplete="off" className={inputClass} />
      </Field>
      {error && <FormMessage>{error}</FormMessage>}
      <div className="flex justify-end">
        <SubmitButton variant="danger" pendingText="Eliminando…">
          <Trash2 aria-hidden />
          Eliminar empresa
        </SubmitButton>
      </div>
    </form>
  );
}
