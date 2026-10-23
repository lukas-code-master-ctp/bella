import { Globe, MailX, Send, Trash2 } from "lucide-react";
import type { EmailSuppressionReason } from "@prisma/client";
import { emailConfigured } from "@/lib/email";
import { defaultFromName, getEmailDomain, type DnsRecord } from "@/lib/domain/email-domains";
import { listEmailSuppressions } from "@/lib/domain/email-suppression";
import { formatChileDateTime } from "@/lib/domain/follow-ups";
import { Badge, PageHeader } from "@/components/ui";
import { Callout, Panel, PanelBody, PanelFooter, StatusPill } from "@/components/settings-ui";
import { CopyField } from "@/components/copy-field";
import { SubmitButton } from "@/components/submit-button";
import { removeEmailDomainAction, resubscribeEmailAction } from "../../actions";
import { ChannelPageActions } from "../parts";
import { CheckDomainButton, ConnectDomainForm, SenderForm } from "./forms";

const STATUS: Record<string, string> = {
  verified: "Verificado",
  pending: "Revisando DNS",
  not_started: "Faltan registros DNS",
  failed: "No se pudo verificar",
  temporary_failure: "Falla temporal del DNS",
};

const REASON: Record<EmailSuppressionReason, { label: string; tone: "neutral" | "warning" | "danger" }> = {
  UNSUBSCRIBED: { label: "Se dio de baja", tone: "neutral" },
  BOUNCED: { label: "Rebotó", tone: "warning" },
  COMPLAINED: { label: "Marcó spam", tone: "danger" },
};

export default async function EmailChannelPage() {
  const [domain, fromName, { rows, total }] = await Promise.all([getEmailDomain(), defaultFromName(), listEmailSuppressions()]);
  const records = (domain?.records ?? []) as DnsRecord[];
  const verified = domain?.status === "verified";

  return (
    <>
      <PageHeader
        title="Correo"
        description="Conecta el dominio de tu empresa para mandar newsletters y envíos masivos por correo desde Envíos masivos."
      >
        <ChannelPageActions claude={false} />
      </PageHeader>
      <div className="space-y-6">
        {!emailConfigured() && (
          <Callout tone="warning" title="El correo no está activo en este servidor">
            Falta la clave de Resend (RESEND_API_KEY) en el servidor de Beliapp. Pídesela al equipo de Beliapp.
          </Callout>
        )}

        {!domain ? (
          <Panel icon={<Globe />} title="Dominio de envío" description="Los correos salen a nombre de tu empresa y desde tu dominio, no desde Beliapp.">
            <ConnectDomainForm fromName={fromName} />
          </Panel>
        ) : (
          <>
            <Panel
              icon={<Globe />}
              title={domain.domain}
              description="Agrega estos registros en el DNS de tu dominio (donde lo compraste: NIC Chile, Cloudflare, GoDaddy…)."
              aside={<StatusPill on={verified} onLabel="Verificado" offLabel={STATUS[domain.status] ?? domain.status} />}
            >
              <PanelBody>
                <ul className="space-y-3">
                  {records.map((r, i) => (
                    <li key={i} className="rounded-lg border border-slate-100 p-3">
                      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                        <Badge tone="brand">{r.type}</Badge>
                        <span className="font-medium text-slate-700">{r.record}</span>
                        {r.priority != null && <span className="text-slate-600">Prioridad {r.priority}</span>}
                        {r.status === "verified" ? <Badge tone="success">Listo</Badge> : <Badge>Pendiente</Badge>}
                      </div>
                      <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                        <CopyField value={r.name} label={`nombre del registro ${r.type}`} />
                        <CopyField value={r.value} label={`valor del registro ${r.type}`} />
                      </div>
                    </li>
                  ))}
                </ul>
                {!verified && (
                  <Callout>
                    En el nombre, algunos proveedores piden solo la parte antes de tu dominio principal. Mientras el dominio no esté
                    verificado no se pueden hacer envíos por correo.
                  </Callout>
                )}
                {domain.checkedAt && <p className="text-xs text-slate-600">Última revisión: {formatChileDateTime(domain.checkedAt)}.</p>}
              </PanelBody>
              <PanelFooter
                note={
                  <form action={removeEmailDomainAction}>
                    <SubmitButton
                      variant="ghost"
                      size="sm"
                      className="-ml-3"
                      pendingText="Quitando…"
                      confirm="¿Quitar el dominio de envío? No se podrán hacer envíos por correo hasta conectar uno de nuevo."
                    >
                      <Trash2 aria-hidden />
                      Quitar dominio
                    </SubmitButton>
                  </form>
                }
              >
                <CheckDomainButton verified={verified} />
              </PanelFooter>
            </Panel>

            <Panel icon={<Send />} title="Remitente">
              <SenderForm fromName={domain.fromName} fromLocal={domain.fromLocal} replyTo={domain.replyTo} domain={domain.domain} />
            </Panel>
          </>
        )}

        <Panel
          icon={<MailX />}
          title="Bajas y rebotes"
          description="A estas direcciones no se les manda ningún envío masivo por correo. Cada correo lleva un enlace para darse de baja en un clic."
        >
          <PanelBody>
            <div className="flex flex-wrap gap-2 text-xs">
              {(Object.keys(REASON) as EmailSuppressionReason[]).map((r) => (
                <Badge key={r} tone={REASON[r].tone}>
                  {REASON[r].label}: {total[r] ?? 0}
                </Badge>
              ))}
            </div>
            {rows.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-600">
                Aún nadie se ha dado de baja.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
                {rows.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
                    <span className="min-w-0 flex-1 truncate font-medium text-slate-900">{s.email}</span>
                    <Badge tone={REASON[s.reason].tone}>{REASON[s.reason].label}</Badge>
                    <span className="text-xs text-slate-600">{formatChileDateTime(s.createdAt)}</span>
                    {s.reason === "UNSUBSCRIBED" && (
                      <form action={resubscribeEmailAction}>
                        <input type="hidden" name="email" value={s.email} />
                        <SubmitButton
                          variant="ghost"
                          size="sm"
                          pendingText="Guardando…"
                          confirm="¿Volver a incluir esta dirección? Hazlo solo si la persona te pidió volver a recibir los correos."
                        >
                          Volver a incluir
                        </SubmitButton>
                      </form>
                    )}
                    {s.detail && <p className="basis-full truncate text-xs text-slate-500">{s.detail}</p>}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-slate-600">
              Las direcciones que rebotaron o marcaron spam quedan fuera para siempre: volver a escribirles daña la reputación de tu
              dominio y hace que tus correos lleguen a spam.
            </p>
          </PanelBody>
        </Panel>
      </div>
    </>
  );
}
