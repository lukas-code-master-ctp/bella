import { Power } from "lucide-react";
import { describeHours, getAiOperation, PREVIOUS_TICKETS, withinBusinessHours } from "@/lib/domain/ai-operation";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { setAiPausedAction } from "./actions";
import { AiOperationForm } from "./form";

export default async function AiOperationPage() {
  const s = await getAiOperation();
  const open = withinBusinessHours(s, new Date());
  return (
    <>
      <PageHeader
        title="Funcionamiento de la IA"
        description="Cuándo responde la asistente en WhatsApp, Instagram y Messenger, y qué sabe de las conversaciones anteriores del cliente. El simulador no se ve afectado, para que puedas probarla siempre."
      />
      <Card className="mb-6 p-5">
        <CardHeader
          title="Apagado general"
          icon={<Power />}
          description={
            s.paused
              ? "La IA no responde ni hace seguimientos en ningún canal. Al encenderla, responde lo que quedó pendiente de los últimos 3 días."
              : "Si la asistente se comporta mal, apágala aquí en todos los canales a la vez. Los ejecutivos siguen respondiendo normalmente."
          }
        >
          <Badge tone={s.paused ? "danger" : "success"}>{s.paused ? "Apagada" : "Encendida"}</Badge>
        </CardHeader>
        <form action={setAiPausedAction.bind(null, !s.paused)} className="mt-4">
          <SubmitButton variant={s.paused ? "primary" : "danger"} pendingText={s.paused ? "Encendiendo…" : "Apagando…"}>
            {s.paused ? "Encender la IA" : "Apagar la IA en todos los canales"}
          </SubmitButton>
        </form>
      </Card>
      <Card className="p-5">
        <AiOperationForm
          settings={s}
          status={s.hoursEnabled ? `${describeHours(s)} (hora de Chile). Ahora: ${open ? "en horario" : "fuera de horario"}.` : null}
          previousTicketsCount={PREVIOUS_TICKETS}
        />
      </Card>
    </>
  );
}
