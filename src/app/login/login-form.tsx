"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { loginAction } from "./actions";
import { Field, FormMessage, inputClass } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export function LoginForm() {
  const [state, action] = useActionState(loginAction, null);
  const [show, setShow] = useState(false);
  return (
    <form action={action} className="space-y-5">
      <Field label="Correo">
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="nombre@empresa.cl"
          defaultValue={state?.email}
          className={inputClass}
        />
      </Field>
      <Field label="Contraseña">
        <span className="relative block">
          <input
            name="password"
            type={show ? "text" : "password"}
            required
            autoComplete="current-password"
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
      <div className="flex items-center justify-between gap-3 text-sm">
        <label className="flex cursor-pointer items-center gap-2 text-slate-700">
          <input type="checkbox" name="remember" defaultChecked={state?.remember} className="size-4 rounded border-slate-300 accent-brand-600" />
          Recordarme
        </label>
        <Link href="/login/recuperar" className="font-medium text-brand-700 hover:text-brand-800 hover:underline">
          ¿Olvidaste tu contraseña?
        </Link>
      </div>
      {state && <FormMessage>{state.error}</FormMessage>}
      <SubmitButton className="w-full" pendingText="Entrando…">
        Entrar
      </SubmitButton>
    </form>
  );
}
