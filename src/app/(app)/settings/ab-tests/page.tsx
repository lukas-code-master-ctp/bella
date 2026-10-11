import type { Channel } from "@prisma/client";
import { FlaskConical, Plus, Sparkles } from "lucide-react";
import { variantStats, type VariantStats } from "@/lib/domain/ab-tests";
import { getAssistantSettings } from "@/lib/settings";
import { CHANNEL_LABEL } from "@/lib/labels";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { Disclosure, Panel, StatusPill } from "@/components/settings-ui";
import { ChannelIcon } from "../channels/channel-icon";
import { NewVariantForm, VariantForm } from "./forms";

const CHANNELS = Object.keys(CHANNEL_LABEL) as Channel[];

const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);

export default async function AbTestsPage() {
  const [variants, assistant] = await Promise.all([variantStats(), getAssistantSettings()]);
  const byChannel = CHANNELS.map((c) => ({ channel: c, variants: variants.filter((v) => v.channel === c) })).filter(
    (g) => g.variants.length,
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Pruebas A/B de la asistente"
        description="Compara versiones de la asistente en un canal. Cada lead nuevo del canal recibe una variante activa al azar, según su peso, y la mantiene toda la conversación. Sin variantes activas, la asistente funciona como siempre."
      />

      {byChannel.length === 0 && (
        <Card className="animate-rise">
          <EmptyState icon={<FlaskConical />} title="Aún no hay pruebas">
            Crea al menos dos variantes en el mismo canal, por ejemplo una sin instrucciones extra (control) y otra con el
            cambio que quieres probar.
          </EmptyState>
        </Card>
      )}

      {byChannel.map((g) => {
        const totalWeight = g.variants.filter((v) => v.active).reduce((n, v) => n + v.weight, 0);
        const best = Math.max(...g.variants.map((v) => v.winRate ?? -1));
        return (
          <section key={g.channel} className="space-y-3">
            <div className="flex items-center gap-3">
              <ChannelIcon kind={g.channel} />
              <h2 className="text-lg font-semibold text-slate-900">{CHANNEL_LABEL[g.channel]}</h2>
            </div>
            <Card className="animate-rise overflow-x-auto">
              <ResultsTable variants={g.variants} totalWeight={totalWeight} best={best} />
            </Card>
            <div className="stagger space-y-3">
              {g.variants.map((v) => (
                <Disclosure
                  key={v.id}
                  icon={<Sparkles />}
                  muted={!v.active}
                  summary={
                    <>
                      <p className="truncate text-sm font-semibold text-slate-900">{v.name}</p>
                      <p className="truncate text-xs text-slate-500">
                        {v.instructions ? v.instructions.slice(0, 120) : "Sin instrucciones extra (control)"}
                      </p>
                    </>
                  }
                  aside={<StatusPill on={v.active} onLabel="Activa" offLabel="Pausada" />}
                >
                  <VariantForm variant={v} defaultAssistant={assistant.assistantName} />
                </Disclosure>
              ))}
            </div>
          </section>
        );
      })}

      <Panel icon={<Plus />} title="Nueva variante" description="Las variantes se comparan solo con las de su mismo canal.">
        <NewVariantForm channels={CHANNELS} defaultAssistant={assistant.assistantName} />
      </Panel>
    </div>
  );
}

function ResultsTable({ variants, totalWeight, best }: { variants: VariantStats[]; totalWeight: number; best: number }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
        <tr>
          <th className="px-4 py-2.5">Variante</th>
          <th className="px-4 py-2.5">Reparto</th>
          <th className="px-4 py-2.5 text-right">Leads</th>
          <th className="px-4 py-2.5 text-right">Abiertos</th>
          <th className="px-4 py-2.5 text-right">Ganados</th>
          <th className="px-4 py-2.5 text-right">Perdidos</th>
          <th className="px-4 py-2.5 text-right" title="Ganados sobre cerrados">
            Tasa de cierre
          </th>
          <th className="px-4 py-2.5 text-right" title="Leads que la asistente derivó a un ejecutivo">
            Derivados
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 tabular-nums">
        {variants.map((v) => {
          const share = v.active && totalWeight ? v.weight / totalWeight : null;
          const leader = v.winRate !== null && v.winRate === best && variants.length > 1;
          return (
            <tr key={v.id} className="transition-colors duration-100 hover:bg-slate-50">
              <td className="px-4 py-3 font-medium text-slate-900">{v.name}</td>
              <td className="px-4 py-3">
                {share === null ? (
                  <span className="text-xs text-slate-500">Pausada</span>
                ) : (
                  <div className="flex min-w-24 items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-brand-500" style={{ width: `${share * 100}%` }} />
                    </div>
                    <span className="w-9 text-right text-xs text-slate-700">{pct(share)}</span>
                  </div>
                )}
              </td>
              <td className="px-4 py-3 text-right">{v.leads}</td>
              <td className="px-4 py-3 text-right">{v.open}</td>
              <td className="px-4 py-3 text-right text-emerald-700">{v.won}</td>
              <td className="px-4 py-3 text-right text-rose-700">{v.lost}</td>
              <td className="px-4 py-3 text-right">
                <span className={`rounded-full px-2 py-0.5 font-semibold ${leader ? "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200" : ""}`}>
                  {pct(v.winRate)}
                </span>
              </td>
              <td className="px-4 py-3 text-right">{v.leads ? pct(v.handedOff / v.leads) : "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
