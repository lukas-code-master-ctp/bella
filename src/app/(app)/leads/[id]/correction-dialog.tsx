"use client";

import { useActionState, useEffect, useRef } from "react";
import Link from "next/link";
import { CircleCheck, Sparkles, TriangleAlert, X } from "lucide-react";
import { Button, buttonClass, FormMessage, inputClass } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { draftLessonAction, saveLessonAction, type CorrectionState } from "./actions";

const INITIAL: CorrectionState = { error: null, feedback: "", draft: null, saved: false };

/**
 * Corregir una respuesta de la IA: quien corrige escribe qué estuvo mal, la IA lo convierte en una
 * regla con su ejemplo, se edita y se guarda como aprendizaje pendiente. Un admin lo aprueba en
 * Configuración → Aprendizajes; hasta entonces no cambia nada en las conversaciones.
 */
export function CorrectionDialog({
  leadId,
  message,
  isAdmin,
  onClose,
}: {
  leadId: string;
  message: { id: string; body: string } | null;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (message) ref.current?.showModal();
    else ref.current?.close();
  }, [message]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby="correction-title"
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl bg-white p-0 shadow-xl backdrop:bg-slate-900/40 open:animate-pop"
    >
      {message && <CorrectionForm key={message.id} leadId={leadId} message={message} isAdmin={isAdmin} onClose={onClose} />}
    </dialog>
  );
}

function CorrectionForm({
  leadId,
  message,
  isAdmin,
  onClose,
}: {
  leadId: string;
  message: { id: string; body: string };
  isAdmin: boolean;
  onClose: () => void;
}) {
  const [drafted, draft] = useActionState(draftLessonAction.bind(null, leadId, message.id), INITIAL);
  const [saved, save] = useActionState(saveLessonAction.bind(null, leadId, message.id), INITIAL);
  const d = drafted.draft;

  return (
    <div className="max-h-[85dvh] overflow-y-auto p-5">
      <div className="mb-4 flex items-start gap-3">
        <h2 id="correction-title" className="flex-1 text-base font-semibold text-slate-900">
          Corregir respuesta de la IA
        </h2>
        <button
          type="button"
          aria-label="Cerrar"
          onClick={onClose}
          className="-mr-2 -mt-2 flex size-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        >
          <X aria-hidden className="size-5" />
        </button>
      </div>

      {saved.saved ? (
        <div className="space-y-4">
          <p className="flex gap-2 text-sm text-slate-700">
            <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            Guardado como aprendizaje pendiente. La IA lo usará cuando un admin lo apruebe en Configuración → Aprendizajes.
          </p>
          <div className="flex justify-end gap-2">
            {isAdmin && (
              <Link href="/settings/lessons" className={buttonClass("secondary")}>
                Revisar ahora
              </Link>
            )}
            <Button type="button" onClick={onClose}>
              Listo
            </Button>
          </div>
        </div>
      ) : (
        <>
          <blockquote className="mb-4 whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-sm leading-relaxed text-slate-700 ring-1 ring-inset ring-slate-200">
            {message.body}
          </blockquote>

          <form action={draft} className="space-y-3">
            <label className="block text-sm font-medium text-slate-700">
              ¿Qué estuvo mal y cómo debió responder?
              <textarea
                name="feedback"
                required
                rows={3}
                autoFocus
                defaultValue={drafted.feedback}
                placeholder="Ej. ya le había dado la ubicación y el precio; solo debía contar lo nuevo y preguntar por su presupuesto."
                className={`${inputClass} mt-1.5`}
              />
            </label>
            {drafted.error && <FormMessage>{drafted.error}</FormMessage>}
            {!d && (
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="ghost" type="button" onClick={onClose}>
                  Cancelar
                </Button>
                <SubmitButton pendingText="Redactando…">
                  <Sparkles aria-hidden />
                  Proponer regla
                </SubmitButton>
              </div>
            )}
          </form>

          {d && (
            <form action={save} className="mt-4 space-y-3 border-t border-slate-100 pt-4">
              {/* La corrección original va con el aprendizaje, para quien lo revise. */}
              <input type="hidden" name="feedback" value={drafted.feedback} />
              <input type="hidden" name="conflict" value={d.conflict} />
              <label className="block text-sm font-medium text-slate-700">
                Regla para la IA
                <textarea name="rule" required rows={3} defaultValue={d.rule} className={`${inputClass} mt-1.5`} />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Así no <span className="font-normal text-slate-500">(opcional)</span>
                <textarea name="badExample" rows={3} defaultValue={d.badExample} className={`${inputClass} mt-1.5`} />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Mejor así <span className="font-normal text-slate-500">(opcional)</span>
                <textarea name="goodExample" rows={3} defaultValue={d.goodExample} className={`${inputClass} mt-1.5`} />
              </label>
              {d.conflict && (
                <p className="flex gap-2 rounded-lg bg-amber-50 p-3 text-[13px] leading-relaxed text-amber-900 ring-1 ring-inset ring-amber-200">
                  <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-600" />
                  <span>
                    <strong className="font-semibold">Posible choque:</strong> {d.conflict} Si la apruebas, esta regla manda.
                  </span>
                </p>
              )}
              {saved.error && <FormMessage>{saved.error}</FormMessage>}
              <div className="flex flex-wrap justify-end gap-2 pt-1">
                <Button variant="ghost" type="button" onClick={onClose}>
                  Cancelar
                </Button>
                <SubmitButton>Guardar para revisión</SubmitButton>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  );
}
