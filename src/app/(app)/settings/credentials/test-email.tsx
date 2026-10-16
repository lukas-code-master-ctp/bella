"use client";

import { useActionState } from "react";
import { Send } from "lucide-react";
import { FormMessage } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { toast } from "@/components/toast";
import { sendTestEmailAction } from "./actions";

/** Botón para revisar que la clave de Resend y el remitente funcionan. */
export function TestEmailButton() {
  const [state, action] = useActionState(async () => {
    const result = await sendTestEmailAction();
    if (result.ok) toast(result.message);
    return result;
  }, null);
  return (
    <form action={action} className="space-y-2">
      <SubmitButton variant="secondary" pendingText="Enviando…">
        <Send aria-hidden />
        Enviarme un correo de prueba
      </SubmitButton>
      {state && !state.ok && <FormMessage>{state.message}</FormMessage>}
    </form>
  );
}
