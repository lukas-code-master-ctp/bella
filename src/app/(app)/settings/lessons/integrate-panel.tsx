"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { CircleCheck, LoaderCircle, Merge } from "lucide-react";
import { buttonClass, type ButtonVariant, FormMessage, inputClass } from "@/components/ui";
import { Panel, PanelBody } from "@/components/settings-ui";
import { toast } from "@/components/toast";
import { diffHunks, lineDiff } from "@/lib/line-diff";
import { integrationAction, type IntegrationState } from "./actions";

const INITIAL: IntegrationState = { error: null, draft: null, saved: false };

/**
 * Incorporar los aprendizajes activos al texto de las instrucciones: la IA propone, se revisa el
 * antes y después (y se puede editar) y recién al guardar cambian las instrucciones.
 */
export function IntegratePanel({ activeCount }: { activeCount: number }) {
  const [state, action] = useActionState(async (prev: IntegrationState, form: FormData) => {
    const result = await integrationAction(prev, form);
    if (result.saved) toast("Instrucciones actualizadas con los aprendizajes");
    return result;
  }, INITIAL);
  const draft = state.draft;

  return (
    <Panel
      icon={<Merge />}
      title="Integrar en las instrucciones"
      description={`La IA incorpora ${activeCount === 1 ? "el aprendizaje activo" : `los ${activeCount} aprendizajes activos`} al texto de tus instrucciones (Asistente IA), junta los repetidos y resuelve los choques. Revisas el cambio antes de guardar; los integrados dejan de enviarse aparte.`}
    >
      <form action={action}>
        <PanelBody>
          {state.saved && !draft && (
            <p className="flex gap-2 text-sm text-slate-700">
              <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              Listo: las instrucciones ya incluyen esos aprendizajes. Los ves en Configuración → Asistente.
            </p>
          )}
          {draft && <Review key={draft.base + draft.instructions.length} current={draft.current} proposed={draft.instructions} changes={draft.changes} />}
          {state.error && <FormMessage>{state.error}</FormMessage>}
          <div className="flex flex-wrap justify-end gap-2">
            {draft ? (
              <>
                <IntentButton intent="discard" variant="ghost" formNoValidate>
                  Descartar
                </IntentButton>
                <IntentButton intent="draft" variant="secondary" pendingText="Reescribiendo…">
                  Proponer otra vez
                </IntentButton>
                <IntentButton intent="apply" variant="success" pendingText="Guardando…">
                  Guardar instrucciones
                </IntentButton>
              </>
            ) : (
              <IntentButton intent="draft" variant="primary" pendingText="Reescribiendo… (puede tardar un minuto)">
                <Merge aria-hidden />
                Proponer versión integrada
              </IntentButton>
            )}
          </div>
        </PanelBody>
      </form>
    </Panel>
  );
}

function Review({ current, proposed, changes }: { current: string; proposed: string; changes: string[] }) {
  const [text, setText] = useState(proposed);
  const hunks = useMemo(() => diffHunks(lineDiff(current, text)), [current, text]);
  return (
    <div className="space-y-4">
      {changes.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Qué cambió</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-slate-700">
            {changes.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Antes y después</p>
        <div className="mt-1.5 max-h-96 overflow-auto rounded-lg font-mono text-[12px] leading-relaxed ring-1 ring-inset ring-slate-200">
          {hunks.length === 0 && <p className="p-3 font-sans text-sm text-slate-600">Sin cambios en el texto.</p>}
          {hunks.map((h, i) => (
            <div key={i}>
              {h.skippedBefore > 0 && (
                <p className="bg-slate-50 px-3 py-1 font-sans text-[11px] text-slate-500">
                  {h.skippedBefore} {h.skippedBefore === 1 ? "línea igual" : "líneas iguales"}
                </p>
              )}
              {h.lines.map((l, j) => (
                <p
                  key={j}
                  className={`whitespace-pre-wrap break-words px-3 ${
                    l.kind === "added" ? "bg-emerald-50 text-emerald-900" : l.kind === "removed" ? "bg-rose-50 text-rose-900 line-through decoration-rose-300" : "text-slate-600"
                  }`}
                >
                  <span aria-hidden className="mr-2 select-none text-slate-400">
                    {l.kind === "added" ? "+" : l.kind === "removed" ? "−" : " "}
                  </span>
                  <span className="sr-only">{l.kind === "added" ? "Agregado: " : l.kind === "removed" ? "Quitado: " : ""}</span>
                  {l.text || " "}
                </p>
              ))}
            </div>
          ))}
        </div>
      </div>
      {/* Aunque <details> esté cerrado, el textarea se envía con el formulario. */}
      <details>
        <summary className="cursor-pointer text-sm font-medium text-brand-700 hover:underline">Editar el texto final antes de guardar</summary>
        <textarea
          name="instructions"
          rows={14}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className={`${inputClass} mt-2 font-mono text-[13px] leading-relaxed`}
        />
      </details>
    </div>
  );
}

function IntentButton({
  intent,
  variant,
  pendingText,
  formNoValidate,
  children,
}: {
  intent: string;
  variant: ButtonVariant;
  pendingText?: string;
  formNoValidate?: boolean;
  children: React.ReactNode;
}) {
  const { pending, data } = useFormStatus();
  const mine = pending && data?.get("intent") === intent;
  return (
    <button type="submit" name="intent" value={intent} disabled={pending} aria-busy={mine} formNoValidate={formNoValidate} className={buttonClass(variant)}>
      {mine ? (
        <>
          <LoaderCircle aria-hidden className="animate-spin" />
          {pendingText ?? "Guardando…"}
        </>
      ) : (
        children
      )}
    </button>
  );
}
