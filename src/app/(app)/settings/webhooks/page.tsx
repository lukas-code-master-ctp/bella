import { ArrowRight, BookOpen, History, Plus, RotateCcw, Trash2, Webhook } from "lucide-react";
import { stageOptions } from "@/lib/domain/funnels";
import { db } from "@/lib/db";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { Disclosure, EventList, Panel, PanelBody, SwitchSubmit } from "@/components/settings-ui";
import { SubmitButton } from "@/components/submit-button";
import { deleteWebhookAction, retryWebhooksAction, toggleWebhookAction } from "./actions";
import { CopySecret, NewWebhookForm, TestWebhookButton } from "./forms";

const STATUS: Record<string, { label: string; tone: "success" | "danger" | "neutral" }> = {
  SENT: { label: "Enviado", tone: "success" },
  PENDING: { label: "Pendiente", tone: "neutral" },
  SENDING: { label: "Enviando", tone: "neutral" },
  FAILED: { label: "Falló", tone: "danger" },
};

const time = (d: Date) =>
  d.toLocaleString("es-CL", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Santiago" });

const code = "rounded bg-slate-100 px-1 py-0.5 font-mono text-xs text-slate-800";

export default async function WebhooksPage() {
  const [webhooks, stages, deliveries] = await Promise.all([
    db.webhook.findMany({ include: { stage: true }, orderBy: { createdAt: "asc" } }),
    stageOptions(),
    db.webhookDelivery.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { webhook: { select: { name: true } }, lead: { select: { id: true, contact: { select: { name: true } } } } },
    }),
  ]);
  const failed = deliveries.some((d) => d.status === "FAILED");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Webhooks"
        description="Cuando un lead entra a una etapa, Beliapp envía sus datos a otro sistema (Zapier, Make, n8n, tu calendario o tu ERP) con un POST en JSON."
      />

      {webhooks.length === 0 ? (
        <Card className="animate-rise">
          <EmptyState icon={<Webhook />} title="Aún no hay webhooks">
            Crea el primero con el formulario de abajo.
          </EmptyState>
        </Card>
      ) : (
        <ul className="stagger space-y-3">
          {webhooks.map((w) => (
            <li key={w.id} className="rounded-xl border border-slate-200 bg-white shadow-xs">
              <div className="flex flex-wrap items-center gap-3 p-4">
                <form action={toggleWebhookAction.bind(null, w.id, !w.active)}>
                  <SwitchSubmit on={w.active} label={w.active ? `Pausar ${w.name}` : `Activar ${w.name}`} />
                </form>
                <div className={`min-w-0 flex-1 ${w.active ? "" : "opacity-60"}`}>
                  <p className="truncate text-sm font-semibold text-slate-900">{w.name}</p>
                  <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-slate-600">
                    <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5">Entra a &quot;{w.stage.name}&quot;</span>
                    <ArrowRight aria-hidden className="size-3.5 shrink-0 text-slate-400" />
                    <span className="truncate font-mono">{w.url}</span>
                  </p>
                </div>
                <TestWebhookButton id={w.id} />
                <form action={deleteWebhookAction.bind(null, w.id)}>
                  <SubmitButton toast="Webhook borrado"
                    variant="ghost-danger"
                    size="icon"
                    aria-label={`Borrar webhook ${w.name}`}
                    title="Borrar webhook"
                    confirm={`¿Borrar el webhook "${w.name}"?`}
                    pendingText=""
                  >
                    <Trash2 aria-hidden />
                  </SubmitButton>
                </form>
              </div>
              <div className="flex min-w-0 items-center gap-2 rounded-b-xl border-t border-slate-100 bg-slate-50/70 px-4 py-2 text-xs text-slate-600">
                <span className="shrink-0 font-medium">Clave de firma</span>
                <CopySecret secret={w.secret} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <Panel icon={<Plus />} title="Nuevo webhook">
        {stages.length === 0 ? (
          <PanelBody>
            <p className="text-sm text-slate-500">Primero crea las etapas en Funnel y etiquetas.</p>
          </PanelBody>
        ) : (
          <NewWebhookForm stages={stages.map((s) => ({ id: s.id, name: s.label }))} />
        )}
      </Panel>

      <Disclosure icon={<BookOpen />} summary={<p className="text-sm font-semibold text-slate-900">Qué envía Beliapp y cómo verificarlo</p>}>
        <div className="space-y-2 text-sm text-slate-600">
          <p>
            Un JSON con <code className={code}>event</code> (&quot;lead.stage_entered&quot;), <code className={code}>stage</code>,{" "}
            <code className={code}>previousStage</code> y <code className={code}>lead</code>: nombre, teléfono, correo, canal,
            etiquetas, campos del cliente, ejecutivo, resumen y puntaje de la IA, y origen (campaña y UTM).
          </p>
          <p>
            Cada envío lleva la cabecera <code className={code}>X-Beliapp-Signature</code> con <code className={code}>sha256=</code> y el
            HMAC-SHA256 del cuerpo con la clave de firma, para que el otro sistema verifique que viene de Beliapp. Si la URL no
            responde con un código 2xx, se reintenta cada 15 minutos hasta 5 veces. Los leads del simulador no disparan
            webhooks.
          </p>
        </div>
      </Disclosure>

      <Panel
        icon={<History />}
        title="Últimos envíos"
        aside={
          failed && (
            <form action={retryWebhooksAction}>
              <SubmitButton variant="secondary" size="sm" pendingText="Reintentando…">
                <RotateCcw aria-hidden />
                Reintentar
              </SubmitButton>
            </form>
          )
        }
      >
        {deliveries.length === 0 ? (
          <EmptyState icon={<History />} title="Aún no hay envíos" />
        ) : (
          <EventList
            rows={deliveries.map((d) => ({
              id: d.id,
              leadId: d.lead.id,
              name: d.lead.contact.name,
              what: d.webhook.name,
              status: STATUS[d.status] ?? { label: d.status, tone: "neutral" },
              at: time(d.sentAt ?? d.createdAt),
              error: d.error,
            }))}
          />
        )}
      </Panel>
    </div>
  );
}
