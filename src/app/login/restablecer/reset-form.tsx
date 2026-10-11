"use client";

import { useActionState, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { resetPasswordAction } from "../actions";
import { Field, FormMessage, inputClass } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export function ResetForm({ token }: { token: string }) {
  const [state, action] = useActionState(resetPasswordAction, null);
  const [show, setShow] = useState(false);
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="token" value={token} />
      <Field label="Nueva contraseña" hint="Mínimo 8 caracteres.">
        <span className="relative block">
          <input
            name="password"
            type={show ? "text" : "password"}
            required
            minLength={8}
            autoComplete="new-password"
            className={`${inputClass} pr-11`}
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-slate-500 hover:text-slate-800"
          >
            {show ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
          </button>
        </span>
      </Field>
      <Field label="Repite la contraseña">
        <input name="confirm" type={show ? "text" : "password"} required minLength={8} autoComplete="new-password" className={inputClass} />
      </Field>
      {state && <FormMessage>{state.error}</FormMessage>}
      <SubmitButton className="w-full" pendingText="Guardando…">
        Guardar contraseña
      </SubmitButton>
    </form>
  );
}
