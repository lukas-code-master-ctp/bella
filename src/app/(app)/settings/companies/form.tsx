"use client";

import { useActionState } from "react";
import { Building2 } from "lucide-react";
import { Field, FormMessage, inputClass } from "@/components/ui";
import { PanelBody, PanelFooter } from "@/components/settings-ui";
import { SubmitButton } from "@/components/submit-button";
import { createCompanyAction } from "./actions";

export function NewCompanyForm() {
  const [error, action] = useActionState(createCompanyAction, null);
  return (
    <form action={action}>
      <PanelBody>
        <Field label="Nombre de la empresa">
          <input name="name" required className={`${inputClass} sm:max-w-sm`} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Administrador">
            <input name="adminName" required placeholder="Nombre y apellido" className={inputClass} />
          </Field>
          <Field label="Correo">
            <input name="adminEmail" type="email" required autoComplete="off" className={inputClass} />
          </Field>
          <Field label="Contraseña inicial" hint="Mínimo 8 caracteres">
            <input name="adminPassword" type="text" required minLength={8} autoComplete="off" className={inputClass} />
          </Field>
        </div>
      </PanelBody>
      <PanelFooter
        note={
          error ? (
            <FormMessage>{error}</FormMessage>
          ) : (
            <FormMessage tone="neutral">Parte con un embudo de ejemplo; el administrador configura el resto.</FormMessage>
          )
        }
      >
        <SubmitButton>
          <Building2 aria-hidden />
          Crear empresa
        </SubmitButton>
      </PanelFooter>
    </form>
  );
}
