"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Phone } from "lucide-react";
import { buttonClass } from "@/components/ui";
import { toast } from "@/components/toast";
import { callOptionAction, requestCallPermissionAction } from "./actions";
import { START_CALL_EVENT, type StartCallDetail } from "./incoming-call";

/**
 * Botón de llamar en el chat de un lead de WhatsApp. Si el cliente ya dio permiso, llama (la llamada
 * sigue en la tarjeta de abajo aunque se cambie de página); si no, ofrece mandarle la solicitud.
 */
export function CallButton({ leadId, name, phone }: StartCallDetail) {
  const [pending, start] = useTransition();
  const router = useRouter();

  const click = () =>
    start(async () => {
      const option = await callOptionAction(leadId);
      if (option.kind === "call") {
        window.dispatchEvent(new CustomEvent<StartCallDetail>(START_CALL_EVENT, { detail: { leadId, name, phone } }));
      } else if (option.kind === "unavailable") {
        toast(option.reason, "error");
      } else if (
        window.confirm(
          `${name} todavía no autoriza que lo llamen por WhatsApp. ¿Le mandamos la solicitud? Le llega un mensaje con botones para aceptar; cuando acepte, podrás llamarlo.`,
        )
      ) {
        const error = await requestCallPermissionAction(leadId);
        if (error) toast(error, "error");
        else {
          toast("Solicitud enviada: te avisamos en el chat cuando responda");
          router.refresh();
        }
      }
    });

  return (
    <button
      type="button"
      onClick={click}
      disabled={pending}
      title="Llamar por WhatsApp"
      aria-label={`Llamar a ${name} por WhatsApp`}
      className={buttonClass("ghost", "icon")}
    >
      <Phone aria-hidden className={pending ? "animate-pulse" : undefined} />
    </button>
  );
}
