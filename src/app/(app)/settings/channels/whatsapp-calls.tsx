"use client";

import { useActionState } from "react";
import { Phone } from "lucide-react";
import type { CallSettings } from "@/lib/domain/calls";
import { FormMessage } from "@/components/ui";
import { Callout, ToggleRow } from "@/components/settings-ui";
import { SubmitButton } from "@/components/submit-button";
import { isSaved, savedToast, withToast } from "@/components/toast";
import { saveCallsAction } from "./call-actions";

/** Configuración → Canales → WhatsApp: recibir llamadas de los clientes en Beliapp. */
export function WhatsAppCallsForm({ settings }: { settings: CallSettings }) {
  const [message, action] = useActionState(withToast(saveCallsAction, savedToast), null);
  return (
    <form action={action} className="space-y-4">
      <ToggleRow
        name="enabled"
        defaultChecked={settings.enabled}
        icon={<Phone />}
        title="Recibir llamadas de WhatsApp"
        description="Los clientes ven el botón de llamar en el chat con tu número. Suena en Beliapp al ejecutivo del lead (o a los administradores, si no tiene) y se contesta desde el navegador, con el micrófono del computador o del celular."
      />
      <Callout title="Antes de activarlas">
        <p>
          Meta pide que el número pueda escribir a 2.000 personas distintas al día o más. Las llamadas que hace el cliente son
          gratis. La llamada queda como nota en el chat del lead, con su duración y quién contestó; si nadie contesta, llega un
          aviso de llamada perdida.
        </p>
      </Callout>
      {message && !isSaved(message) && <FormMessage>{message}</FormMessage>}
      <SubmitButton pendingText="Guardando en Meta…">Guardar</SubmitButton>
    </form>
  );
}
