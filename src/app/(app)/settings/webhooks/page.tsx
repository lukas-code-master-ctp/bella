import Link from "next/link";
import { RotateCcw, Trash2, Webhook } from "lucide-react";
import { db } from "@/lib/db";
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
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

export default async function WebhooksPage() {
  const [webhooks, stages, deliveries] = await Promise.all([
    db.webhook.findMany({ include: { stage: true }, orderBy: { createdAt: "asc" } }),
    db.stage.findMany({ orderBy: { position: "asc" } }),
    db.webhookDelivery.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { webhook: { select: { name: true } }, lead: { select: { id: true, contact: { select: { name: true } } } } },
    }),
  ]);
  const failed = deliveries.some((d) => d.status === "FAILED");

  return (
    <>
      <PageHeader
        title="Webhooks"
        description="Cuando un lead entra a una etapa, Bella envía sus datos a otro sistema (Zapier, Make, n8n, tu calendario o tu ERP) con un POST en JSON."
      />
      <div className="space-y-6">
        <Card className="divide-y divide-slate-100">
          {webhooks.length === 0 && (
            <EmptyState icon={<Webhook />} title="Aún no hay webhooks">
              Crea el primero con el formulario de abajo.
            </EmptyState>
          )}
          {webhooks.map((w) => (
            <div key={w.id} className="space-y-3 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <div className={`min-w-0 flex-1 ${w.active ? "" : "opacity-60"}`}>
                  <div className="flex items-center gap-2 font-semibold text-slate-900">
                    {w.name}
                    {w.active ? <Badge tone="success">Activo</Badge> : <Badge>Pausado</Badge>}
                  </div>
                  <div className="mt-0.5 text-slate-600">Entra a la etapa &quot;{w.stage.name}&quot;</div>
                  <div className="mt-0.5 truncate font-mono text-xs text-slate-500">{w.url}</div>
                </div>
                <form action={toggleWebhookAction.bind(null, w.id, !w.active)}>
                  <Button variant="secondary">{w.active ? "Pausar" : "Activar"}</Button>
                </form>
                <form action={deleteWebhookAction.bind(null, w.id)}>
                  <SubmitButton
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
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2 text-xs text-slate-600">
                  <span className="shrink-0">Clave de firma</span>
                  <CopySecret secret={w.secret} />
                </div>
                <TestWebhookButton id={w.id} />
              </div>
            </div>
          ))}
        </Card>

        <Card className="p-5">
          <CardHeader title="Nuevo webhook" />
          {stages.length === 0 ? (
            <p className="text-sm text-slate-500">Primero crea las etapas en Funnel y etiquetas.</p>
          ) : (
            <NewWebhookForm stages={stages.map((s) => ({ id: s.id, name: s.name }))} />
          )}
        </Card>

        <Card className="p-5">
          <CardHeader title="Qué envía Bella" />
          <div className="space-y-2 text-sm text-slate-600">
            <p>
              Un JSON con <code className="font-mono text-xs">event</code> (&quot;lead.stage_entered&quot;),{" "}
              <code className="font-mono text-xs">stage</code>, <code className="font-mono text-xs">previousStage</code> y{" "}
              <code className="font-mono text-xs">lead</code>: nombre, teléfono, correo, canal, etiquetas, campos del cliente,
              ejecutivo, resumen y puntaje de la IA, y origen (campaña y UTM).
            </p>
            <p>
              Cada envío lleva la cabecera <code className="font-mono text-xs">X-Bella-Signature</code> con{" "}
              <code className="font-mono text-xs">sha256=</code> y el HMAC-SHA256 del cuerpo con la clave de firma, para que el
              otro sistema verifique que viene de Bella. Si la URL no responde con un código 2xx, se reintenta cada 15 minutos
              hasta 5 veces. Los leads del simulador no disparan webhooks.
            </p>
          </div>
        </Card>

        <Card className="p-5">
          <CardHeader title="Últimos envíos">
            {failed && (
              <form action={retryWebhooksAction}>
                <SubmitButton variant="secondary">
                  <RotateCcw aria-hidden />
                  Reintentar
                </SubmitButton>
              </form>
            )}
          </CardHeader>
          {deliveries.length === 0 ? (
            <p className="text-sm text-slate-500">Aún no hay envíos.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {deliveries.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                  <Link href={`/leads/${d.lead.id}`} className="font-medium text-slate-900 hover:text-brand-700 hover:underline">
                    {d.lead.contact.name}
                  </Link>
                  <span className="text-slate-600">{d.webhook.name}</span>
                  <Badge tone={STATUS[d.status]?.tone ?? "neutral"} className="ml-auto">
                    {STATUS[d.status]?.label ?? d.status}
                  </Badge>
                  <time className="w-28 text-right text-xs tabular-nums text-slate-500">{time(d.sentAt ?? d.createdAt)}</time>
                  {d.error && <p className="w-full text-xs text-rose-700">{d.error}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
