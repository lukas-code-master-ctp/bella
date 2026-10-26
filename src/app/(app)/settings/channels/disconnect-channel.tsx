"use client";

import { useActionState, useEffect } from "react";
import { Trash2 } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";
import { toast } from "@/components/toast";
import { disconnectChannelAction } from "../actions";
import type { ChannelKind } from "./channel-icon";

const CONFIRM: Partial<Record<ChannelKind, string>> = {
  WHATSAPP:
    "¿Eliminar WhatsApp? Se borran el token y el número (y los números extra) de Beliapp: dejan de llegar y salir mensajes. Los leads y sus chats se conservan, y en Meta el número sigue igual.",
  INSTAGRAM:
    "¿Eliminar Instagram? Instagram y Messenger usan la misma página de Facebook, así que se desconectan los dos. Los leads y sus chats se conservan.",
  FACEBOOK:
    "¿Eliminar Messenger? Instagram y Messenger usan la misma página de Facebook, así que se desconectan los dos. Los leads y sus chats se conservan.",
  WEB: "¿Eliminar el widget web? La burbuja deja de mostrarse en tu sitio. Su diseño queda guardado por si lo vuelves a activar.",
  EMAIL: "¿Eliminar el correo? Se quita el dominio de envío y no se podrán hacer envíos por correo hasta conectar uno de nuevo.",
};

/** Botón de la lista de canales conectados para quitar uno, con confirmación. */
export function DisconnectChannel({ kind, name }: { kind: ChannelKind; name: string }) {
  const [error, action] = useActionState(disconnectChannelAction, null);
  useEffect(() => {
    if (error) toast(error, "error");
  }, [error]);
  return (
    <form action={action}>
      <input type="hidden" name="kind" value={kind} />
      <SubmitButton
        variant="ghost"
        size="icon"
        title="Eliminar canal"
        className="size-8 text-slate-500 hover:text-red-600"
        confirm={CONFIRM[kind] ?? `¿Eliminar ${name}?`}
      >
        <Trash2 aria-label={`Eliminar ${name}`} />
      </SubmitButton>
    </form>
  );
}
