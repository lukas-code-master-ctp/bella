"use client";

import { useActionState, useState } from "react";
import { Eye, EyeOff, KeyRound, Save } from "lucide-react";
import { Field, FormMessage, inputClass } from "@/components/ui";
import { PanelBody, PanelFooter } from "@/components/settings-ui";
import { SubmitButton } from "@/components/submit-button";
import { changePasswordAction, updateNameAction, type ProfileState } from "./actions";
import { withToast } from "@/components/toast";

function Result({ state }: { state: ProfileState }) {
  if (!state || state.ok) return null;
  return <FormMessage>{state.message}</FormMessage>;
}

export function NameForm({ name, email }: { name: string; email: string }) {
  const [state, action] = useActionState(withToast(updateNameAction, (s) => (s?.ok ? s.message : null)), null);
  return (
    <form action={action}>
      <PanelBody>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre">
            <input name="name" required maxLength={80} defaultValue={name} autoComplete="name" className={inputClass} />
          </Field>
          <Field label="Correo" hint="Es tu usuario para entrar. Si necesitas cambiarlo, pídeselo a un administrador.">
            <input value={email} readOnly disabled className={`${inputClass} bg-slate-50 text-slate-600`} />
          </Field>
        </div>
      </PanelBody>
      <PanelFooter note={<Result state={state} />}>
        <SubmitButton pendingText="Guardando…">
          <Save aria-hidden />
          Guardar
        </SubmitButton>
      </PanelFooter>
    </form>
  );
}

export function PasswordForm() {
  const [state, action] = useActionState(withToast(changePasswordAction, (s) => (s?.ok ? s.message : null)), null);
  const [show, setShow] = useState(false);
  const type = show ? "text" : "password";
  return (
    <form action={action}>
      <PanelBody>
        <Field label="Contraseña actual">
          <span className="relative block">
            <input name="current" type={type} required autoComplete="current-password" className={`${inputClass} pr-11`} />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? "Ocultar contraseñas" : "Mostrar contraseñas"}
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-slate-500 hover:text-slate-800"
            >
              {show ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
            </button>
          </span>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nueva contraseña" hint="Mínimo 8 caracteres.">
            <input name="password" type={type} required minLength={8} autoComplete="new-password" className={inputClass} />
          </Field>
          <Field label="Repite la nueva contraseña">
            <input name="confirm" type={type} required minLength={8} autoComplete="new-password" className={inputClass} />
          </Field>
        </div>
      </PanelBody>
      <PanelFooter note={state ? <Result state={state} /> : "Al cambiarla se cierra la sesión en tus otros dispositivos."}>
        <SubmitButton pendingText="Cambiando…">
          <KeyRound aria-hidden />
          Cambiar contraseña
        </SubmitButton>
      </PanelFooter>
    </form>
  );
}
