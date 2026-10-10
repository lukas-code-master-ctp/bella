import type { Channel } from "@prisma/client";
import { FlaskConical } from "lucide-react";
import { variantStats, type VariantStats } from "@/lib/domain/ab-tests";
import { getAssistantSettings } from "@/lib/settings";
import { CHANNEL_LABEL } from "@/lib/labels";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { NewVariantForm, VariantForm } from "./forms";

const CHANNELS = Object.keys(CHANNEL_LABEL) as Channel[];

const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);

export default async function AbTestsPage() {
  const [variants, assistant] = await Promise.all([variantStats(), getAssistantSettings()]);
  const byChannel = CHANNELS.map((c) => ({ channel: c, variants: variants.filter((v) => v.channel === c) })).filter(
    (g) => g.variants.length,
  );

  return (
    <>
      <PageHeader
        title="Pruebas A/B de la asistente"
        description="Compara versiones de la asistente en un canal. Cada lead nuevo del canal recibe una variante activa al azar, según su peso, y la mantiene toda la conversación. Sin variantes activas, la asistente funciona como siempre."
      />

      {byChannel.length === 0 && (
        <Card className="mb-6">
          <EmptyState icon={<FlaskConical />} title="Aún no hay pruebas">
            Crea al menos dos variantes en el mismo canal, por ejemplo una sin instrucciones extra (control) y otra con el
            cambio que quieres probar.
          </EmptyState>
        </Card>
      )}

      {byChannel.map((g) => (
        <section key={g.channel} className="mb-8">
          <h2 className="mb-3 text-lg font-semibold text-slate-900">{CHANNEL_LABEL[g.channel]}</h2>
          <Card className="mb-4 overflow-x-auto">
            <ResultsTable variants={g.variants} />
          </Card>
          <div className="space-y-4">
            {g.variants.map((v) => (
              <Card key={v.id} className="p-5">
                <CardHeader title={v.name}>{v.active ? <Badge tone="success">Activa</Badge> : <Badge>Pausada</Badge>}</CardHeader>
                <VariantForm variant={v} defaultAssistant={assistant.assistantName} />
              </Card>
            ))}
          </div>
        </section>
      ))}

      <Card className="p-5">
        <CardHeader title="Nueva variante" description="Las variantes se comparan solo con las de su mismo canal." />
        <NewVariantForm channels={CHANNELS} defaultAssistant={assistant.assistantName} />
      </Card>
    </>
  );
}

function ResultsTable({ variants }: { variants: VariantStats[] }) {
  const totalWeight = variants.filter((v) => v.active).reduce((n, v) => n + v.weight, 0);
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
        <tr>
          <th className="px-4 py-2">Variante</th>
          <th className="px-4 py-2 text-right">Reparto</th>
          <th className="px-4 py-2 text-right">Leads</th>
          <th className="px-4 py-2 text-right">Abiertos</th>
          <th className="px-4 py-2 text-right">Ganados</th>
          <th className="px-4 py-2 text-right">Perdidos</th>
          <th className="px-4 py-2 text-right" title="Ganados sobre cerrados">
            Tasa de cierre
          </th>
          <th className="px-4 py-2 text-right" title="Leads que la asistente derivó a un ejecutivo">
            Derivados
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 tabular-nums">
        {variants.map((v) => (
          <tr key={v.id}>
            <td className="px-4 py-2 font-medium text-slate-900">{v.name}</td>
            <td className="px-4 py-2 text-right text-slate-700">{v.active && totalWeight ? pct(v.weight / totalWeight) : "Pausada"}</td>
            <td className="px-4 py-2 text-right">{v.leads}</td>
            <td className="px-4 py-2 text-right">{v.open}</td>
            <td className="px-4 py-2 text-right">{v.won}</td>
            <td className="px-4 py-2 text-right">{v.lost}</td>
            <td className="px-4 py-2 text-right font-semibold">{pct(v.winRate)}</td>
            <td className="px-4 py-2 text-right">{v.leads ? pct(v.handedOff / v.leads) : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
