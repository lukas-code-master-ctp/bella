"use client";

import { useActionState } from "react";
import { Mic, Phone } from "lucide-react";
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
      <ToggleRow
        name="record"
        defaultChecked={settings.record}
        icon={<Mic />}
        title="Grabar y resumir las llamadas"
        description="Se graban las dos voces desde el navegador de quien atiende. Al cortar, la grabación queda en el chat con su transcripción y un resumen de la IA, que propone tareas de lo acordado. La asistente lee el resumen para no volver a preguntar lo que ya se habló."
      />
      <Callout title="Antes de activarlas">
        <p>
          Meta pide que el número pueda escribir a 2.000 personas distintas al día o más. Las llamadas que hace el cliente son
          gratis. La llamada queda como nota en el chat del lead, con su duración y quién contestó; si nadie contesta, llega un
          aviso de llamada perdida.
        </p>
        <p className="mt-2">
          Si grabas las llamadas, avísale al cliente al empezar (por ejemplo: &quot;Te cuento que esta llamada queda grabada&quot;): en
          Chile hay que informarle que la conversación se graba.
        </p>
      </Callout>
      {message && !isSaved(message) && <FormMessage>{message}</FormMessage>}
      <SubmitButton pendingText="Guardando en Meta…">Guardar</SubmitButton>
    </form>
  );
}
