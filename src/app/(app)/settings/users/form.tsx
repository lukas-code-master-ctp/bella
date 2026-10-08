"use client";

import { useActionState } from "react";
import { Field, FormMessage, inputClass } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { createUserAction } from "../actions";

export function NewUserForm() {
  const [error, action] = useActionState(createUserAction, null);
  return (
    <form
      action={action}
      className="grid gap-3 sm:grid-cols-2"
    >
      <Field label="Nombre">
        <input name="name" required className={inputClass} />
      </Field>
      <Field label="Correo">
        <input name="email" type="email" required autoComplete="off" className={inputClass} />
      </Field>
      <Field label="Contraseña inicial" hint="Mínimo 8 caracteres">
        <input name="password" type="text" required minLength={8} className={inputClass} />
      </Field>
      <Field label="Perfil">
        <select name="role" className={inputClass}>
          <option value="EXECUTIVE">Ejecutivo</option>
          <option value="ADMIN">Admin</option>
        </select>
      </Field>
      <div className="flex items-center gap-3 sm:col-span-2">
        <SubmitButton>Crear usuario</SubmitButton>
        {error && <FormMessage>{error}</FormMessage>}
      </div>
    </form>
  );
}
