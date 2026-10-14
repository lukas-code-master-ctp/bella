import { Archive, CalendarX2, History, Hourglass } from "lucide-react";
import { stageOptions } from "@/lib/domain/funnels";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { effectiveDays, getAutoCloseSettings, type AutoCloseRun } from "@/lib/domain/auto-close";
import { Field, inputClass, PageHeader } from "@/components/ui";
import { Callout, Chip, FieldGroup, Panel, PanelBody, PanelFooter, Stat, StatusPill, ToggleRow } from "@/components/settings-ui";
import { SubmitButton } from "@/components/submit-button";
import { saveAutoCloseAction } from "../actions";

export default async function AutoCloseSettingsPage() {
  const [s, lastRun, stages] = await Promise.all([
    getAutoCloseSettings(),
    getSetting<AutoCloseRun | null>("autoCloseRun", null),
    stageOptions(),
  ]);
  const days = await effectiveDays(s.days);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Cierre automático"
        description="Una vez al día, Beliapp cierra como perdidos los leads que quedaron sin actividad, para que el funnel no se llene de tickets muertos."
      />

      <div className="stagger grid gap-3 sm:grid-cols-3">
        <Stat icon={<Hourglass />} label="Se cierra a los" value={`${s.enabled ? days : s.days} días`} hint="sin actividad" />
        <Stat
          icon={<History />}
          label="Última pasada"
          value={lastRun ? new Date(lastRun.at).toLocaleDateString("es-CL", { day: "numeric", month: "short", timeZone: "America/Santiago" }) : "—"}
          hint={lastRun ? new Date(lastRun.at).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", timeZone: "America/Santiago" }) : "Aún no corre"}
        />
        <Stat icon={<Archive />} label="Cerrados en esa pasada" value={lastRun ? lastRun.closed : "—"} hint={lastRun ? (lastRun.closed === 1 ? "lead" : "leads") : undefined} />
      </div>

      <Panel
        icon={<CalendarX2 />}
        title="Reglas de cierre"
        aside={<StatusPill on={s.enabled} onLabel="Activo" offLabel="Apagado" />}
      >
        <form action={saveAutoCloseAction}>
          <PanelBody>
            <ToggleRow name="enabled" defaultChecked={s.enabled} title="Activar cierre automático" description="Corre una vez al día." />
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <Field label="Días sin actividad" hint="Sin mensajes ni movimientos de nadie.">
                <input type="number" name="days" min={1} max={365} required defaultValue={s.days} className={inputClass} />
              </Field>
              <Field label="Motivo de pérdida" hint="Queda registrado en el lead y en su historial.">
                <input name="reason" required defaultValue={s.reason} className={inputClass} />
              </Field>
            </div>
            <Callout tone="neutral">
              Cada seguimiento de reactivación reinicia el plazo (y si la reactivación espera más entre intentos, se usa esa
              espera más un día). Nunca se cierra un lead cuyo último mensaje es del cliente sin respuesta.
              {s.enabled && days > s.days && ` Por los plazos de la reactivación, hoy se cierra a los ${days} días.`}
            </Callout>
            <FieldGroup
              title="Etapas que cierran el lead"
              description="Los leads en estas etapas se cierran como perdidos en la siguiente pasada, sin esperar los días de inactividad. El motivo es el que se dio al moverlos ahí, o el de arriba."
            >
              <div className="flex flex-wrap gap-2">
                {stages.map((st) => (
                  <Chip key={st.id} name="lostStageIds" value={st.id} defaultChecked={s.lostStageIds.includes(st.id)}>
                    {st.label}
                  </Chip>
                ))}
              </div>
            </FieldGroup>
          </PanelBody>
          <PanelFooter>
            <SubmitButton>Guardar</SubmitButton>
          </PanelFooter>
        </form>
      </Panel>
    </div>
  );
}
