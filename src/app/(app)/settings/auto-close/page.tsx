import { Archive, CalendarX2, History, Hourglass, Trophy } from "lucide-react";
import { stageOptions } from "@/lib/domain/funnels";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { effectiveDays, getAutoCloseSettings, type AutoCloseRun } from "@/lib/domain/auto-close";
import { getWonStagesSettings } from "@/lib/domain/leads";
import { Field, inputClass, PageHeader } from "@/components/ui";
import { Callout, Chip, Panel, PanelBody, PanelFooter, Stat, StatusPill } from "@/components/settings-ui";
import { ToggleSection } from "@/components/toggle-section";
import { SubmitButton } from "@/components/submit-button";
import { saveAutoCloseAction, saveWonStagesAction } from "../actions";

export default async function AutoCloseSettingsPage() {
  const [s, won, lastRun, stages] = await Promise.all([
    getAutoCloseSettings(),
    getWonStagesSettings(),
    getSetting<AutoCloseRun | null>("autoCloseRun", null),
    stageOptions(),
  ]);
  const days = await effectiveDays(s.days);
  // Marcar la primera etapa de un embudo cierra a los leads nuevos al día siguiente: casi siempre es un error.
  const firstStages = new Set(
    stages.filter((st, i) => i === 0 || stages[i - 1].funnelId !== st.funnelId).map((st) => st.id),
  );
  const riskyFirst = stages.filter((st) => firstStages.has(st.id) && s.lostStageIds.includes(st.id));
  const openInMarked = s.lostStagesEnabled && s.lostStageIds.length
    ? await db.lead.count({ where: { status: "OPEN", stageId: { in: s.lostStageIds } } })
    : 0;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Cierre automático"
        description="Beliapp cierra como perdidos los leads que quedaron sin actividad, para que el funnel no se llene de tickets muertos, y marca como ganados los que llegan a una etapa de ganado."
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
            <ToggleSection name="enabled" defaultChecked={s.enabled} title="Activar cierre automático" description="Corre una vez al día.">
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
              <ToggleSection
                name="lostStagesEnabled"
                defaultChecked={s.lostStagesEnabled}
                title="Cerrar al instante en etapas de descarte"
                description="Aparte de los días: los leads en las etapas marcadas (como “Perdidos”) se cierran en la siguiente pasada, sin esperar. El motivo es el que se dio al moverlos ahí, o el de arriba."
              >
                <div className="flex flex-wrap gap-2">
                  {stages.map((st) => (
                    <Chip key={st.id} name="lostStageIds" value={st.id} defaultChecked={s.lostStageIds.includes(st.id)}>
                      {st.label}
                    </Chip>
                  ))}
                </div>
                {s.lostStagesEnabled && riskyFirst.length > 0 && (
                  <Callout tone="danger" title="Esto cierra a los leads nuevos">
                    Marcaste {riskyFirst.map((st) => `“${st.label}”`).join(", ")}, la etapa donde entran los leads: se cerrarán
                    como perdidos al día siguiente de escribir. Desmárcala salvo que sea lo que quieres.
                  </Callout>
                )}
                {s.enabled && s.lostStagesEnabled && openInMarked > 0 && (
                  <Callout tone="warning">
                    Hoy hay {openInMarked} {openInMarked === 1 ? "lead abierto" : "leads abiertos"} en las etapas marcadas: se
                    cierran en la próxima pasada.
                  </Callout>
                )}
              </ToggleSection>
            </ToggleSection>
          </PanelBody>
          <PanelFooter>
            <SubmitButton toast="Cambios guardados">Guardar</SubmitButton>
          </PanelFooter>
        </form>
      </Panel>

      <Panel
        icon={<Trophy />}
        title="Etapas de ganado"
        description="Cuando un lead entra a una de estas etapas, sea porque lo movió la IA o una persona, se marca como ganado al instante."
        aside={<StatusPill on={won.enabled} onLabel="Activo" offLabel="Apagado" />}
      >
        <form action={saveWonStagesAction}>
          <PanelBody>
            <ToggleSection
              name="enabled"
              defaultChecked={won.enabled}
              title="Marcar como ganado al entrar a una etapa"
              description="El lead se cierra como ganado sin monto (se puede reabrir), la IA deja de responderle y, si el píxel de Meta está activo, se envía la compra."
            >
              <div className="flex flex-wrap gap-2">
                {stages.map((st) => (
                  <Chip key={st.id} name="stageIds" value={st.id} defaultChecked={won.stageIds.includes(st.id)}>
                    {st.label}
                  </Chip>
                ))}
              </div>
            </ToggleSection>
          </PanelBody>
          <PanelFooter>
            <SubmitButton toast="Cambios guardados">Guardar</SubmitButton>
          </PanelFooter>
        </form>
      </Panel>
    </div>
  );
}
