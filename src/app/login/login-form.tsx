"use client";

import { useActionState } from "react";
import { loginAction } from "./actions";
import { Field, inputClass } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export function LoginForm() {
  const [state, action] = useActionState(loginAction, null);
  return (
    <form action={action} className="space-y-4">
      <Field label="Correo">
        <input name="email" type="email" required autoComplete="email" defaultValue={state?.email} className={inputClass} />
      </Field>
      <Field label="Contraseña">
        <input name="password" type="password" required autoComplete="current-password" className={inputClass} />
      </Field>
      {state && <p className="text-sm text-rose-600">{state.error}</p>}
      <SubmitButton className="w-full" pendingText="Entrando…">
        Entrar
      </SubmitButton>
    </form>
  );
}
