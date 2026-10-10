import Link from "next/link";
import { CircleCheck, CircleDashed, RotateCcw } from "lucide-react";
import { stageOptions } from "@/lib/domain/funnels";
import { db } from "@/lib/db";
import { getPixelSettings, pixelToken } from "@/lib/domain/conversions";
import { Badge, Card, CardHeader, Field, inputClass, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { retryConversionsAction, savePixelAction } from "../actions";

const checkClass = "size-4 rounded border-slate-300 accent-brand-600";

const KIND_LABEL: Record<string, string> = { QUALIFIED: "Lead calificado", PURCHASE: "Venta" };
const STATUS: Record<string, { label: string; tone: "success" | "danger" | "warning" | "neutral" }> = {
  SENT: { label: "Enviado", tone: "success" },
  PENDING: { label: "Pendiente", tone: "neutral" },
  SENDING: { label: "Enviando", tone: "neutral" },
  FAILED: { label: "Falló", tone: "danger" },
  SKIPPED: { label: "Omitido", tone: "warning" },
};

const time = (d: Date) =>
  d.toLocaleString("es-CL", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Santiago" });

export default async function PixelSettingsPage() {
  const [s, stages, events] = await Promise.all([
    getPixelSettings(),
    stageOptions(),
    db.conversionEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { lead: { select: { id: true, contact: { select: { name: true } } } } },
    }),
  ]);
  const hasToken = Boolean(pixelToken());
  const hasWaba = Boolean(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID);
  const failed = events.some((e) => e.status === "FAILED");

  return (
    <>
      <PageHeader
        title="Píxel de Meta"
        description="Con la API de Conversiones, Bella le avisa a Meta qué leads se calificaron y cuáles compraron, para que los anuncios busquen personas parecidas."
      />
      <div className="space-y-6">
        <Card className="p-5">
          <CardHeader title="Conexión" description="Se envía desde el servidor; no hace falta instalar nada en la web.">
            {s.enabled && s.datasetId && hasToken ? <Badge tone="success">Encendida</Badge> : <Badge>Apagada</Badge>}
          </CardHeader>
          <ul className="mb-5 space-y-2 text-sm">
            {(
              [
                ["META_CAPI_TOKEN", hasToken, "Token de acceso de la API de Conversiones (Administrador de eventos → tu píxel → Configuración → Generar token)."],
                [
                  "WHATSAPP_BUSINESS_ACCOUNT_ID",
                  hasWaba,
                  "Opcional. Id de la cuenta de WhatsApp Business (WhatsApp Manager); mejora la atribución de los anuncios de clic a WhatsApp.",
                ],
              ] as const
            ).map(([key, ok, help]) => (
              <li key={key} className="flex gap-2">
                {ok ? (
                  <CircleCheck aria-label="Configurada" className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                ) : (
                  <CircleDashed aria-label="Falta" className="mt-0.5 size-4 shrink-0 text-slate-400" />
                )}
                <span>
                  <code className="font-mono text-[13px] font-semibold text-slate-900">{key}</code>
                  <span className="block text-xs text-slate-600">{help}</span>
                </span>
              </li>
            ))}
          </ul>
          <form action={savePixelAction} className="grid gap-4 sm:grid-cols-2">
            <Field label="Id del píxel (dataset)" hint="Administrador de eventos → Orígenes de datos.">
              <input name="datasetId" inputMode="numeric" defaultValue={s.datasetId} placeholder="123456789012345" className={inputClass} />
            </Field>
            <Field label="Etapa de lead calificado" hint="Al entrar a esta etapa se envía el evento.">
              <select name="qualifiedStageId" defaultValue={s.qualifiedStageId} className={inputClass}>
                <option value="">No enviar lead calificado</option>
                {stages.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Código de prueba (opcional)" hint="De la pestaña Probar eventos. Bórralo cuando termines de probar.">
              <input name="testEventCode" defaultValue={s.testEventCode} placeholder="TEST12345" className={inputClass} />
            </Field>
            <label className="flex min-h-10 items-center gap-2 self-end text-sm font-medium text-slate-800">
              <input type="checkbox" name="enabled" defaultChecked={s.enabled} className={checkClass} />
              Enviar eventos a Meta
            </label>
            <p className="text-xs text-slate-600 sm:col-span-2">
              Las ventas se envían al marcar un lead como ganado, con su monto en pesos. Solo cuentan los leads desde que la
              enciendes.
            </p>
            <div>
              <SubmitButton>Guardar</SubmitButton>
            </div>
          </form>
        </Card>

        <Card className="p-5">
          <CardHeader title="Últimos eventos" description="Lo que Bella le envió a Meta. Los que fallan se reintentan cada 15 minutos.">
            {failed && (
              <form action={retryConversionsAction}>
                <SubmitButton variant="secondary">
                  <RotateCcw aria-hidden />
                  Reintentar
                </SubmitButton>
              </form>
            )}
          </CardHeader>
          {events.length === 0 ? (
            <p className="text-sm text-slate-500">Aún no hay eventos.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {events.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                  <Link href={`/leads/${e.lead.id}`} className="font-medium text-slate-900 hover:text-brand-700 hover:underline">
                    {e.lead.contact.name}
                  </Link>
                  <span className="text-slate-600">
                    {KIND_LABEL[e.kind] ?? e.kind}
                    {e.value ? ` · $${e.value.toLocaleString("es-CL")}` : ""}
                  </span>
                  <Badge tone={STATUS[e.status]?.tone ?? "neutral"} className="ml-auto">
                    {STATUS[e.status]?.label ?? e.status}
                  </Badge>
                  <time className="w-28 text-right text-xs tabular-nums text-slate-500">{time(e.sentAt ?? e.createdAt)}</time>
                  {e.error && <p className="w-full text-xs text-rose-700">{e.error}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
