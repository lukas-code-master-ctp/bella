"use client";

import { useActionState } from "react";
import { Headset, ShieldCheck, UserPlus } from "lucide-react";
import { Field, FormMessage, inputClass } from "@/components/ui";
import { ChoiceCard, PanelBody, PanelFooter } from "@/components/settings-ui";
import { SubmitButton } from "@/components/submit-button";
import { createUserAction } from "../actions";
import { withToast } from "@/components/toast";

export function NewUserForm() {
  const [error, action] = useActionState(withToast(createUserAction, (e) => (e ? null : "Usuario creado. Le mandamos un correo de bienvenida.")), null);
  return (
    <form action={action}>
      <PanelBody>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Nombre">
            <input name="name" required className={inputClass} />
          </Field>
          <Field label="Correo">
            <input name="email" type="email" required autoComplete="off" className={inputClass} />
          </Field>
          <Field label="Contraseña inicial" hint="Mínimo 8 caracteres">
            <input name="password" type="text" required minLength={8} autoComplete="off" className={inputClass} />
          </Field>
        </div>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium text-slate-800">Perfil</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <ChoiceCard name="role" value="EXECUTIVE" defaultChecked icon={<Headset />} title="Ejecutivo" description="Atiende sus leads y tareas." />
            <ChoiceCard name="role" value="ADMIN" icon={<ShieldCheck />} title="Admin" description="Además, ve todo y entra a Configuración." />
          </div>
        </fieldset>
      </PanelBody>
      <PanelFooter note={error && <FormMessage>{error}</FormMessage>}>
        <SubmitButton>
          <UserPlus aria-hidden />
          Crear usuario
        </SubmitButton>
      </PanelFooter>
    </form>
  );
}
