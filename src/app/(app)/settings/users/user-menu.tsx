"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Ellipsis, Headset, Mail, Pencil, Power, PowerOff, Save, ShieldCheck, Trash2, X } from "lucide-react";
import { Dropdown } from "@/components/dropdown";
import { dropdownItemClass, Field, FormMessage, inputClass } from "@/components/ui";
import { ChoiceCard } from "@/components/settings-ui";
import { SubmitButton } from "@/components/submit-button";
import { toast } from "@/components/toast";
import { deleteUserAction, resendInvitationAction, toggleUserAction, updateUserAction } from "../actions";

type User = { id: string; name: string; email: string; role: "ADMIN" | "EXECUTIVE"; active: boolean };

/** Menú ⋯ de un usuario: editar, activar o desactivar y eliminar. */
export function UserMenu({ user, isMe }: { user: User; isMe: boolean }) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (editing) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [editing]);

  function remove() {
    if (!window.confirm(`¿Eliminar a ${user.name}? Ya no podrá entrar y sus leads y tareas abiertas quedarán sin asignar. Su historial se conserva.`)) return;
    start(async () => {
      const error = await deleteUserAction(user.id);
      toast(error ?? `${user.name} eliminado`, error ? "error" : undefined);
    });
  }

  function invite() {
    start(async () => {
      const error = await resendInvitationAction(user.id);
      toast(error ?? `Le mandamos a ${user.name} un correo para crear su contraseña`, error ? "error" : undefined);
    });
  }

  function toggle() {
    start(async () => {
      await toggleUserAction(user.id, !user.active);
      toast(user.active ? `${user.name} desactivado` : `${user.name} activado`);
    });
  }

  return (
    <>
      <Dropdown
        label={`Acciones de ${user.name}`}
        button={<Ellipsis aria-hidden className="size-5" />}
        buttonClassName={`flex size-10 items-center justify-center rounded-lg text-slate-600 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-900 ${pending ? "opacity-60" : ""}`}
        width="w-52"
      >
        <button type="button" role="menuitem" tabIndex={-1} onClick={() => setEditing(true)} className={dropdownItemClass()}>
          <Pencil aria-hidden />
          Editar
        </button>
        {!isMe && (
          <>
            {user.active && (
              <button type="button" role="menuitem" tabIndex={-1} onClick={invite} className={dropdownItemClass()}>
                <Mail aria-hidden />
                Reenviar invitación
              </button>
            )}
            <button type="button" role="menuitem" tabIndex={-1} onClick={toggle} className={dropdownItemClass()}>
              {user.active ? <PowerOff aria-hidden /> : <Power aria-hidden />}
              {user.active ? "Desactivar" : "Activar"}
            </button>
            <div role="separator" className="my-1 h-px bg-slate-100" />
            <button type="button" role="menuitem" tabIndex={-1} onClick={remove} className={dropdownItemClass(true)}>
              <Trash2 aria-hidden />
              Eliminar…
            </button>
          </>
        )}
      </Dropdown>

      <dialog
        ref={dialogRef}
        onClose={() => setEditing(false)}
        onClick={(e) => e.target === dialogRef.current && setEditing(false)}
        aria-labelledby={`edit-user-${user.id}`}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-white p-0 shadow-xl backdrop:bg-slate-900/40 open:animate-pop"
      >
        {editing && (
          <div className="p-5">
            <div className="mb-4 flex items-start gap-3">
              <h2 id={`edit-user-${user.id}`} className="flex-1 text-base font-semibold text-slate-900">
                Editar usuario
              </h2>
              <button
                type="button"
                aria-label="Cerrar"
                onClick={() => setEditing(false)}
                className="-mr-2 -mt-2 flex size-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              >
                <X aria-hidden className="size-5" />
              </button>
            </div>
            <EditForm user={user} isMe={isMe} onDone={() => setEditing(false)} />
          </div>
        )}
      </dialog>
    </>
  );
}

function EditForm({ user, isMe, onDone }: { user: User; isMe: boolean; onDone: () => void }) {
  const [error, action] = useActionState(async (prev: string | null, form: FormData) => {
    const result = await updateUserAction(user.id, prev, form);
    if (!result) {
      toast("Usuario guardado");
      onDone();
    }
    return result;
  }, null);
  return (
    <form action={action} className="space-y-4">
      <Field label="Nombre">
        <input name="name" required defaultValue={user.name} className={inputClass} />
      </Field>
      <Field label="Correo">
        <input name="email" type="email" required defaultValue={user.email} autoComplete="off" className={inputClass} />
      </Field>
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium text-slate-800">Perfil</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <ChoiceCard name="role" value="EXECUTIVE" defaultChecked={user.role === "EXECUTIVE"} disabled={isMe} icon={<Headset />} title="Ejecutivo" description="Atiende sus leads y tareas." />
          <ChoiceCard name="role" value="ADMIN" defaultChecked={user.role === "ADMIN"} disabled={isMe} icon={<ShieldCheck />} title="Admin" description="Además, ve todo y entra a Configuración." />
        </div>
        {/* Un input deshabilitado no se envía: tu propio perfil viaja igual. */}
        {isMe && <input type="hidden" name="role" value={user.role} />}
      </fieldset>
      {error && <FormMessage>{error}</FormMessage>}
      <div className="flex justify-end">
        <SubmitButton>
          <Save aria-hidden />
          Guardar
        </SubmitButton>
      </div>
    </form>
  );
}
