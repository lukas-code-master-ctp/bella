import { Activity, Crosshair, RotateCcw } from "lucide-react";
import { stageOptions } from "@/lib/domain/funnels";
import { db } from "@/lib/db";
import { credentials } from "@/lib/credentials";
import { getPixelSettings } from "@/lib/domain/conversions";
import { EmptyState, Field, inputClass, PageHeader } from "@/components/ui";
import { EnvChecklist, EventList, Panel, PanelBody, PanelFooter, StatusPill, ToggleRow } from "@/components/settings-ui";
import { SubmitButton } from "@/components/submit-button";
import { retryConversionsAction, savePixelAction } from "../actions";

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
  const creds = await credentials();
  const hasToken = Boolean(creds.META_CAPI_TOKEN);
  const hasWaba = Boolean(creds.WHATSAPP_BUSINESS_ACCOUNT_ID);
  const failed = events.some((e) => e.status === "FAILED");
  const on = s.enabled && Boolean(s.datasetId) && hasToken;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Píxel de Meta"
        description="Con la API de Conversiones, Beliapp le avisa a Meta qué leads se calificaron y cuáles compraron, para que los anuncios busquen personas parecidas."
      />
      <Panel
        icon={<Crosshair />}
        title="Conexión"
        description="Se envía desde el servidor; no hace falta instalar nada en la web."
        aside={<StatusPill on={on} onLabel="Encendida" offLabel="Apagada" />}
      >
        <form action={savePixelAction}>
          <PanelBody>
            <EnvChecklist
              items={[
                ["Token de la API de Conversiones", hasToken, "En Configuración → Credenciales. Token de acceso de la API de Conversiones (Administrador de eventos → tu píxel → Configuración → Generar token)."],
                [
                  "Id de la cuenta de WhatsApp Business",
                  hasWaba,
                  "Opcional, en Credenciales. Está en WhatsApp Manager; mejora la atribución de los anuncios de clic a WhatsApp.",
                ],
              ]}
            />
            <ToggleRow
              name="enabled"
              defaultChecked={s.enabled}
              title="Enviar eventos a Meta"
              description="Las ventas se envían al marcar un lead como ganado, con su monto en pesos. Solo cuentan los leads desde que la enciendes."
            />
            <div className="grid gap-4 sm:grid-cols-2">
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
                <input name="testEventCode" defaultValue={s.testEventCode} placeholder="TEST12345" className={`${inputClass} font-mono`} />
              </Field>
            </div>
          </PanelBody>
          <PanelFooter>
            <SubmitButton>Guardar</SubmitButton>
          </PanelFooter>
        </form>
      </Panel>

      <Panel
        icon={<Activity />}
        title="Últimos eventos"
        description="Lo que Beliapp le envió a Meta. Los que fallan se reintentan cada 15 minutos."
        aside={
          failed && (
            <form action={retryConversionsAction}>
              <SubmitButton variant="secondary" size="sm" pendingText="Reintentando…">
                <RotateCcw aria-hidden />
                Reintentar
              </SubmitButton>
            </form>
          )
        }
      >
        {events.length === 0 ? (
          <EmptyState icon={<Activity />} title="Aún no hay eventos">
            Aparecen aquí cuando un lead llega a la etapa de calificado o se marca como ganado.
          </EmptyState>
        ) : (
          <EventList
            rows={events.map((e) => ({
              id: e.id,
              leadId: e.lead.id,
              name: e.lead.contact.name,
              what: `${KIND_LABEL[e.kind] ?? e.kind}${e.value ? ` · $${e.value.toLocaleString("es-CL")}` : ""}`,
              status: STATUS[e.status] ?? { label: e.status, tone: "neutral" },
              at: time(e.sentAt ?? e.createdAt),
              error: e.error,
            }))}
          />
        )}
      </Panel>
    </div>
  );
}
