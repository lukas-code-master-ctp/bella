import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { getAutoCloseSettings, type AutoCloseRun } from "@/lib/domain/auto-close";
import { Card, Field, inputClass, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { saveAutoCloseAction } from "../actions";

const checkClass = "size-4 rounded border-slate-300 accent-brand-600";

export default async function AutoCloseSettingsPage() {
  const [s, lastRun, stages] = await Promise.all([
    getAutoCloseSettings(),
    getSetting<AutoCloseRun | null>("autoCloseRun", null),
    db.stage.findMany({ orderBy: { position: "asc" } }),
  ]);
  return (
    <>
      <PageHeader
        title="Cierre automático"
        description="Una vez al día, Bella cierra como perdidos los leads que quedaron sin actividad, para que el funnel no se llene de tickets muertos."
      />
      <Card className="p-5">
        <form action={saveAutoCloseAction} className="space-y-4">
          <label className="flex min-h-10 items-center gap-2 text-sm font-medium text-slate-800">
            <input type="checkbox" name="enabled" defaultChecked={s.enabled} className={checkClass} /> Activar cierre
            automático
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Días sin actividad"
              hint="Sin mensajes ni movimientos de nadie. Cada seguimiento de reactivación reinicia el plazo, y nunca se cierra un lead cuyo último mensaje es del cliente sin respuesta."
            >
              <input type="number" name="days" min={1} max={365} required defaultValue={s.days} className={inputClass} />
            </Field>
            <Field label="Motivo de pérdida" hint="Queda registrado en el lead y en su historial.">
              <input name="reason" required defaultValue={s.reason} className={inputClass} />
            </Field>
          </div>
          <fieldset>
            <legend className="text-sm font-medium text-slate-800">Etapas que cierran el lead</legend>
            <p className="mt-1 text-xs text-slate-600">
              Los leads en estas etapas se cierran como perdidos en la siguiente pasada, sin esperar los días de
              inactividad. El motivo es el que se dio al moverlos ahí, o el de arriba.
            </p>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
              {stages.map((st) => (
                <label key={st.id} className="flex min-h-10 items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    name="lostStageIds"
                    value={st.id}
                    defaultChecked={s.lostStageIds.includes(st.id)}
                    className={checkClass}
                  />
                  {st.name}
                </label>
              ))}
            </div>
          </fieldset>
          <SubmitButton>Guardar</SubmitButton>
        </form>
        {lastRun && (
          <p className="mt-3 text-xs text-slate-600">
            Última pasada: {new Date(lastRun.at).toLocaleString("es-CL", { timeZone: "America/Santiago" })} ·{" "}
            {lastRun.closed} {lastRun.closed === 1 ? "lead cerrado" : "leads cerrados"}
          </p>
        )}
      </Card>
    </>
  );
}
