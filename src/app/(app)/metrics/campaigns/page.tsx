import Link from "next/link";
import { ArrowLeft, BellRing, CircleCheck, Megaphone } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import type { CampaignAdvice } from "@/lib/ai/campaign-advice";
import { activeCampaignAlerts, getCampaignAlertSettings, type Reason } from "@/lib/domain/campaign-alerts";
import { Badge, buttonClass, Card, CardHeader, EmptyState, Field, inputClass, PageHeader } from "@/components/ui";
import { Callout } from "@/components/settings-ui";
import { SubmitButton } from "@/components/submit-button";
import { saveCampaignAlertsAction } from "./actions";
import { AdviceButton, CheckButton, PauseButton } from "./alert-buttons";

const day = (d: Date) => d.toLocaleDateString("es-CL", { day: "numeric", month: "short", timeZone: "America/Santiago" });
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");

export default async function CampaignAlertsPage() {
  await requireAdmin();
  const [cfg, alerts] = await Promise.all([getCampaignAlertSettings(), activeCampaignAlerts()]);

  return (
    <>
      <PageHeader
        title="Campañas en alerta"
        description={`Campañas con ${cfg.minLeads} leads o más en los últimos ${cfg.days} días donde al menos el ${cfg.lostPct}% terminó perdido. La IA lee las conversaciones perdidas y recomienda cómo mejorar la campaña o si conviene apagarla.`}
      >
        <Link href="/metrics" className={buttonClass("ghost")}>
          <ArrowLeft aria-hidden />
          Métricas
        </Link>
        <CheckButton />
      </PageHeader>

      <div className="stagger space-y-6">
        {!cfg.enabled ? (
          <Callout tone="neutral" title="La revisión de campañas está apagada">
            Enciéndela abajo para que Beliapp revise las campañas dos veces al día y avise a los admins.
          </Callout>
        ) : alerts.length === 0 ? (
          <Card>
            <EmptyState icon={<CircleCheck />} title="Ninguna campaña en alerta">
              Beliapp revisa las campañas a las 9:00 y a las 17:00. Si los leads de una campaña se pierden casi todos, aparece aquí y te
              llega un aviso.
            </EmptyState>
          </Card>
        ) : (
          alerts.map((a) => {
            const advice = a.advice as CampaignAdvice | null;
            const reasons = a.reasons as Reason[];
            return (
              <Card key={a.id} className="p-5">
                <CardHeader
                  icon={<Megaphone />}
                  title={a.campaign}
                  description={`${a.lost} de ${a.leads} leads perdidos (${pct(a.lost, a.leads)}) · ${a.won} ganados · en alerta desde el ${day(a.detectedAt)}`}
                >
                  {a.pausedAt ? (
                    <Badge>Pausada en Meta el {day(a.pausedAt)}</Badge>
                  ) : advice?.shouldPause ? (
                    <Badge tone="danger">La IA sugiere apagarla</Badge>
                  ) : (
                    <Badge tone="warning">Muchos perdidos</Badge>
                  )}
                </CardHeader>

                <div className="grid gap-5 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Motivos de pérdida</p>
                    {reasons.length ? (
                      <ul className="space-y-1.5 text-sm">
                        {reasons.map((r) => (
                          <li key={r.reason} className="flex items-baseline justify-between gap-3">
                            <span className="truncate text-slate-800" title={r.reason}>
                              {r.reason}
                            </span>
                            <span className="tabular-nums text-slate-900">{r.count}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-slate-500">Sin motivos registrados.</p>
                    )}
                  </div>

                  <div className="space-y-4">
                    {advice ? (
                      <>
                        <p className="text-sm leading-relaxed text-slate-800">{advice.diagnosis}</p>
                        {advice.causes.length > 0 && <AdviceList title="Por qué se pierden" items={advice.causes} />}
                        {advice.improvements.length > 0 && <AdviceList title="Qué cambiar en la campaña" items={advice.improvements} />}
                        {advice.shouldPause && (
                          <Callout tone="danger" title="La IA recomienda apagarla">
                            {advice.pauseReason || "No ve un arreglo razonable para esta campaña."}
                          </Callout>
                        )}
                        <p className="text-xs text-slate-500">
                          Generado por la IA ({a.adviceModel}) el {day(a.adviceAt!)}. Revisa los datos antes de tomar decisiones.
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-slate-500">Aún no hay recomendación de la IA para esta campaña.</p>
                    )}
                    <div className="flex flex-wrap items-start gap-2">
                      <AdviceButton alertId={a.id} label={advice ? "Actualizar recomendación" : "Pedir recomendación"} />
                      {cfg.allowPause && !a.pausedAt && a.campaignId && <PauseButton alertId={a.id} campaign={a.campaign} />}
                    </div>
                    {cfg.allowPause && !a.pausedAt && !a.campaignId && (
                      <p className="text-xs text-slate-600">
                        No se puede pausar desde Beliapp: no se conoce el id de esta campaña en Meta (viene de un enlace con UTM o falta el
                        token de anuncios). Páusala desde el Administrador de anuncios.
                      </p>
                    )}
                  </div>
                </div>
              </Card>
            );
          })
        )}

        <Card className="p-5">
          <CardHeader
            icon={<BellRing />}
            title="Cuándo alertar"
            description="Solo avisa al equipo (un aviso al navegador de los admins); nunca escribe a los leads."
          />
          <form action={saveCampaignAlertsAction} className="space-y-4">
            <label className="flex min-h-10 items-center gap-2 text-sm font-medium text-slate-800">
              <input type="checkbox" name="enabled" defaultChecked={cfg.enabled} className="size-4 rounded border-slate-300 accent-brand-600" />
              Revisar las campañas dos veces al día y avisar a los admins
            </label>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Mínimo de leads" hint="Con menos leads no se juzga la campaña">
                <input type="number" name="minLeads" min={3} max={1000} defaultValue={cfg.minLeads} className={inputClass} />
              </Field>
              <Field label="% de perdidos" hint="Sobre todos los leads de la campaña">
                <input type="number" name="lostPct" min={30} max={100} defaultValue={cfg.lostPct} className={inputClass} />
              </Field>
              <Field label="Días que se revisan" hint="Leads que llegaron en esos días">
                <input type="number" name="days" min={3} max={90} defaultValue={cfg.days} className={inputClass} />
              </Field>
            </div>
            <div className="space-y-2 border-t border-slate-100 pt-4">
              <label className="flex min-h-10 items-center gap-2 text-sm font-medium text-slate-800">
                <input type="checkbox" name="allowPause" defaultChecked={cfg.allowPause} className="size-4 rounded border-slate-300 accent-brand-600" />
                Mostrar el botón para pausar la campaña en Meta
              </label>
              <Callout tone="warning">
                Beliapp nunca pausa una campaña por su cuenta: un admin lo confirma con el botón. Para pausar, el token de anuncios de{" "}
                <Link href="/settings/credentials" className="font-medium text-brand-700 underline">
                  Credenciales
                </Link>{" "}
                necesita el permiso <strong>ads_management</strong> (no basta con ads_read). En el Business Manager, al usuario del sistema
                dale control total de la cuenta publicitaria y genera el token marcando ads_management.
              </Callout>
            </div>
            <SubmitButton toast="Cambios guardados">Guardar</SubmitButton>
          </form>
        </Card>
      </div>
    </>
  );
}

function AdviceList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">{title}</p>
      <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-700 marker:text-brand-500">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
