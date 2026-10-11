import { Power, PowerOff } from "lucide-react";
import { describeHours, getAiOperation, PREVIOUS_TICKETS, withinBusinessHours } from "@/lib/domain/ai-operation";
import { Card, PageHeader } from "@/components/ui";
import { StatusPill } from "@/components/settings-ui";
import { SubmitButton } from "@/components/submit-button";
import { setAiPausedAction } from "./actions";
import { AiOperationForm } from "./form";

export default async function AiOperationPage() {
  const s = await getAiOperation();
  const open = withinBusinessHours(s, new Date());
  return (
    <div className="space-y-6">
      <PageHeader
        title="Funcionamiento de la IA"
        description="Cuándo responde la asistente en WhatsApp, Instagram y Messenger, y qué sabe de las conversaciones anteriores del cliente. El simulador no se ve afectado, para que puedas probarla siempre."
      />
      <Card
        className={`animate-rise overflow-hidden ${s.paused ? "border-rose-200 bg-gradient-to-br from-rose-50 to-white" : "border-emerald-200 bg-gradient-to-br from-emerald-50/70 to-white"}`}
      >
        <div className="flex flex-wrap items-center gap-4 p-5">
          <span
            className={`flex size-12 shrink-0 items-center justify-center rounded-2xl [&_svg]:size-6 ${s.paused ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}
          >
            {s.paused ? <PowerOff aria-hidden /> : <Power aria-hidden />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-slate-900">Interruptor general</h2>
              <StatusPill on={!s.paused} onLabel="Respondiendo" offLabel="Apagada" />
            </div>
            <p className="mt-0.5 text-sm text-slate-600">
              {s.paused
                ? "La IA no responde ni hace seguimientos en ningún canal. Al encenderla, responde lo que quedó pendiente de los últimos 3 días."
                : "Si la asistente se comporta mal, apágala aquí en todos los canales a la vez. Los ejecutivos siguen respondiendo normalmente."}
            </p>
          </div>
          <form action={setAiPausedAction.bind(null, !s.paused)}>
            <SubmitButton variant={s.paused ? "success" : "danger"} pendingText={s.paused ? "Encendiendo…" : "Apagando…"}>
              {s.paused ? <Power aria-hidden /> : <PowerOff aria-hidden />}
              {s.paused ? "Encender la IA" : "Apagar en todos los canales"}
            </SubmitButton>
          </form>
        </div>
      </Card>
      <AiOperationForm
        settings={s}
        status={s.hoursEnabled ? `${describeHours(s)} (hora de Chile). Ahora: ${open ? "en horario" : "fuera de horario"}.` : null}
        previousTicketsCount={PREVIOUS_TICKETS}
      />
    </div>
  );
}
