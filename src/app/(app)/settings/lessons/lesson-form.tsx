"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Check, FlaskConical, LoaderCircle, Pause, Play, Trash2, TriangleAlert } from "lucide-react";
import type { AiLessonStatus } from "@prisma/client";
import { buttonClass, type ButtonVariant, FormMessage, inputClass } from "@/components/ui";
import { toast } from "@/components/toast";
import { lessonAction, type LessonActionState } from "./actions";

export type LessonView = {
  id: string;
  status: AiLessonStatus;
  rule: string;
  badExample: string;
  goodExample: string;
  feedback: string;
  conflict: string;
  testReply: string | null;
  testedAt: string | null;
};

const INITIAL: LessonActionState = { error: null, done: null };

/** Edición, prueba y aprobación de un aprendizaje. */
export function LessonForm({ lesson }: { lesson: LessonView }) {
  const [state, action] = useActionState(async (prev: LessonActionState, form: FormData) => {
    const result = await lessonAction(lesson.id, prev, form);
    if (result.done) toast(result.done);
    return result;
  }, INITIAL);

  return (
    <form action={action} className="space-y-4">
      {lesson.feedback && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Corrección</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{lesson.feedback}</p>
        </div>
      )}
      <label className="block text-sm font-medium text-slate-700">
        Regla para la IA
        <textarea name="rule" required rows={3} defaultValue={lesson.rule} className={`${inputClass} mt-1.5`} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-700">
          Así no <span className="font-normal text-slate-500">(opcional)</span>
          <textarea name="badExample" rows={4} defaultValue={lesson.badExample} className={`${inputClass} mt-1.5`} />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Mejor así <span className="font-normal text-slate-500">(opcional)</span>
          <textarea name="goodExample" rows={4} defaultValue={lesson.goodExample} className={`${inputClass} mt-1.5`} />
        </label>
      </div>

      {lesson.conflict && (
        <p className="flex gap-2 rounded-lg bg-amber-50 p-3 text-[13px] leading-relaxed text-amber-900 ring-1 ring-inset ring-amber-200">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <span>
            <strong className="font-semibold">Posible choque:</strong> {lesson.conflict} Si la apruebas, esta regla manda.
          </span>
        </p>
      )}

      {lesson.testReply && (
        <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <FlaskConical aria-hidden className="size-3.5" />
            Con la regla, la IA respondería
            {lesson.testedAt && <span className="font-normal normal-case tracking-normal">· {lesson.testedAt}</span>}
          </p>
          <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{lesson.testReply}</p>
        </div>
      )}

      {state.error && <FormMessage>{state.error}</FormMessage>}

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
        <IntentButton intent="delete" variant="ghost-danger" confirm="¿Borrar este aprendizaje? La IA dejará de usarlo.">
          <Trash2 aria-hidden />
          {lesson.status === "PENDING" ? "Descartar" : "Borrar"}
        </IntentButton>
        <span className="flex-1" />
        <IntentButton intent="test" variant="secondary" title="La IA vuelve a escribir la respuesta corregida con esta regla. No se envía a nadie.">
          <FlaskConical aria-hidden />
          {lesson.testReply ? "Probar de nuevo" : "Probar"}
        </IntentButton>
        <IntentButton intent="save" variant="secondary">
          Guardar
        </IntentButton>
        {lesson.status === "PENDING" && (
          <IntentButton intent="approve" variant="success">
            <Check aria-hidden />
            Aprobar
          </IntentButton>
        )}
        {lesson.status === "ACTIVE" && (
          <IntentButton intent="pause" variant="secondary">
            <Pause aria-hidden />
            Pausar
          </IntentButton>
        )}
        {lesson.status === "PAUSED" && (
          <IntentButton intent="resume" variant="success">
            <Play aria-hidden />
            Activar
          </IntentButton>
        )}
      </div>
    </form>
  );
}

/** Botón de envío con su acción; muestra el giro solo en el que se apretó. */
function IntentButton({
  intent,
  variant,
  confirm,
  title,
  children,
}: {
  intent: string;
  variant: ButtonVariant;
  confirm?: string;
  title?: string;
  children: React.ReactNode;
}) {
  const { pending, data } = useFormStatus();
  const mine = pending && data?.get("intent") === intent;
  return (
    <button
      type="submit"
      name="intent"
      value={intent}
      title={title}
      disabled={pending}
      aria-busy={mine}
      formNoValidate={intent === "delete"}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className={buttonClass(variant)}
    >
      {mine ? (
        <>
          <LoaderCircle aria-hidden className="animate-spin" />
          {intent === "test" ? "Probando…" : "Guardando…"}
        </>
      ) : (
        children
      )}
    </button>
  );
}
