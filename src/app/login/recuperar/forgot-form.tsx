"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ArrowLeft, MailCheck } from "lucide-react";
import { forgotPasswordAction } from "../actions";
import { Field, FormMessage, inputClass } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export function ForgotForm() {
  const [state, action] = useActionState(forgotPasswordAction, null);
  const back = (
    <Link href="/login" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:text-brand-800 hover:underline">
      <ArrowLeft aria-hidden className="size-4" />
      Volver a iniciar sesión
    </Link>
  );
  if (state?.sent) {
    return (
      <div className="space-y-6">
        <div className="flex gap-3 rounded-lg bg-brand-50 p-4 ring-1 ring-brand-100">
          <MailCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-brand-700" />
          <p role="status" className="text-sm text-slate-700">
            Si <strong>{state.email}</strong> tiene una cuenta, te llegará un correo con un enlace para elegir una nueva
            contraseña. El enlace vence en 1 hora. Revisa también la carpeta de spam.
          </p>
        </div>
        {back}
      </div>
    );
  }
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
      {state?.error && <FormMessage>{state.error}</FormMessage>}
      <SubmitButton className="w-full" pendingText="Enviando…">
        Enviar enlace
      </SubmitButton>
      <div className="text-center">{back}</div>
    </form>
  );
}
