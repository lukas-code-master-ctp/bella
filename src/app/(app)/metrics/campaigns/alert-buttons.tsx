"use client";

import { useActionState } from "react";
import { Pause, RefreshCw, Sparkles } from "lucide-react";
import { FormMessage } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { checkCampaignsAction, pauseCampaignAction, refreshAdviceAction } from "./actions";

export function CheckButton() {
  const [error, action] = useActionState(checkCampaignsAction, null);
  return (
    <form action={action} className="flex flex-col items-start gap-2 sm:items-end">
      <SubmitButton variant="secondary" pendingText="Revisando…">
        <RefreshCw aria-hidden />
        Revisar ahora
      </SubmitButton>
      {error && <FormMessage>{error}</FormMessage>}
    </form>
  );
}

export function AdviceButton({ alertId, label }: { alertId: string; label: string }) {
  const [error, action] = useActionState(refreshAdviceAction.bind(null, alertId), null);
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <SubmitButton variant="secondary" size="sm" pendingText="Analizando los leads perdidos…">
        <Sparkles aria-hidden />
        {label}
      </SubmitButton>
      {error && <FormMessage>{error}</FormMessage>}
    </form>
  );
}

export function PauseButton({ alertId, campaign }: { alertId: string; campaign: string }) {
  const [error, action] = useActionState(pauseCampaignAction.bind(null, alertId), null);
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <SubmitButton
        variant="danger"
        size="sm"
        pendingText="Pausando en Meta…"
        confirm={`¿Pausar la campaña "${campaign}" en Meta? Deja de gastar y de mostrar anuncios. Puedes volver a activarla desde el Administrador de anuncios.`}
      >
        <Pause aria-hidden />
        Pausar campaña en Meta
      </SubmitButton>
      {error && <FormMessage>{error}</FormMessage>}
    </form>
  );
}
