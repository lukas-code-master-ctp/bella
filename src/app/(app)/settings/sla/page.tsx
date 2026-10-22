import Link from "next/link";
import { describeHours } from "@/lib/domain/ai-operation";
import { getSlaSettings } from "@/lib/domain/sla";
import { PageHeader } from "@/components/ui";
import { SlaForm } from "./form";

export default async function SlaSettingsPage() {
  const s = await getSlaSettings();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Tiempos de respuesta"
        description={
          <>
            Las metas (SLA) con que se mide al equipo cuando un lead lo atiende una persona. El cumplimiento de cada ejecutivo se ve en{" "}
            <Link href="/metrics/sla" className="font-medium text-brand-700 underline">
              Métricas → SLA de ejecutivos
            </Link>
            .
          </>
        }
      />
      <SlaForm
        settings={s}
        hoursStatus={s.hoursEnabled ? `${describeHours(s)} (hora de Chile).` : "Sin horario: se cuentan las 24 horas."}
      />
    </div>
  );
}
