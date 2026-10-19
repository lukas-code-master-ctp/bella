"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { BookOpen, Bot, CircleCheck, GitBranch, LoaderCircle, MessageCircle, Sparkles } from "lucide-react";
import { buttonClass, type ButtonVariant, Field, FormMessage, inputClass } from "@/components/ui";
import { Panel, PanelBody } from "@/components/settings-ui";
import { toast } from "@/components/toast";
import { setupAction, type SetupState } from "./actions";

const QUESTIONS = [
  ["offer", "¿Qué vende tu empresa y a quién?", "Ej.: departamentos en Santiago para familias jóvenes; cursos online de inglés para adultos.", 3],
  ["tone", "¿Cómo quieres que hable?", "Ej.: cercana, con tuteo, sin emojis; formal y precisa.", 2],
  ["qualify", "¿Qué datos debe pedir para calificar a un cliente?", "Ej.: nombre, comuna, presupuesto, cuándo quiere comprar, si necesita crédito.", 3],
  ["handoff", "¿Cuándo debe pasar la conversación a una persona?", "Ej.: cuando pide una visita, quiere pagar, está molesto o pide un descuento.", 2],
  ["avoid", "¿Qué no debe decir ni prometer?", "Ej.: no dar descuentos, no confirmar fechas de entrega, no hablar de la competencia.", 2],
] as const;

export function SetupWizard({ companyName, assistantName }: { companyName: string; assistantName: string }) {
  const initial: SetupState = {
    error: null,
    answers: { companyName, assistantName, offer: "", tone: "", qualify: "", handoff: "", avoid: "", facts: "" },
    draft: null,
    saved: false,
  };
  const [state, action] = useActionState(async (prev: SetupState, form: FormData) => {
    const result = await setupAction(prev, form);
    if (result.saved && !prev.saved) toast("Asistente configurada");
    return result;
  }, initial);
  const { answers, draft } = state;

  if (state.saved && !draft) {
    return (
      <Panel icon={<CircleCheck />} title="Tu asistente quedó configurada" description="Puedes ajustar todo después en Asistente IA, Conocimiento y Funnel.">
        <PanelBody>
          <p className="text-sm text-slate-700">Ahora conversa con ella en el simulador como si fueras un cliente y corrige lo que no te guste.</p>
          <div className="flex flex-wrap gap-2">
            <Link href="/chats/simulator" className={buttonClass("primary")}>
              <MessageCircle aria-hidden />
              Probar en el simulador
            </Link>
            <Link href="/settings" className={buttonClass("secondary")}>
              Volver a Configura tu empresa
            </Link>
          </div>
        </PanelBody>
      </Panel>
    );
  }

  if (!draft) {
    return (
      <form action={action} className="space-y-6">
        <Panel icon={<Bot />} title="Tu empresa y tu asistente" description="Mientras más concreto, mejor queda.">
          <PanelBody>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nombre de la empresa">
                <input name="companyName" required defaultValue={answers.companyName} className={inputClass} />
              </Field>
              <Field label="Nombre de la asistente">
                <input name="assistantName" defaultValue={answers.assistantName} className={inputClass} />
              </Field>
            </div>
            {QUESTIONS.map(([name, label, hint, rows]) => (
              <Field key={name} label={label} hint={hint}>
                <textarea name={name} rows={rows} required={name === "offer"} defaultValue={answers[name]} className={inputClass} />
              </Field>
            ))}
          </PanelBody>
        </Panel>
        <Panel
          icon={<BookOpen />}
          title="Datos para responder"
          description="Opcional. Pega productos, precios, formas de pago, preguntas frecuentes, horarios o políticas. La IA los ordena en documentos de Conocimiento y no inventa lo que falte."
        >
          <PanelBody>
            <textarea name="facts" rows={8} defaultValue={answers.facts} aria-label="Datos para responder" className={`${inputClass} leading-relaxed`} />
            {state.error && <FormMessage>{state.error}</FormMessage>}
            <div className="flex justify-end">
              <IntentButton intent="draft" variant="primary" pendingText="Redactando… (puede tardar un minuto)">
                <Sparkles aria-hidden />
                Redactar con IA
              </IntentButton>
            </div>
          </PanelBody>
        </Panel>
      </form>
    );
  }

  return (
    <form action={action} key={draft.instructions.length} className="space-y-6">
      <Panel icon={<Bot />} title="Instrucciones" description="Así se presenta y atiende la asistente. Edítalas si algo no calza.">
        <PanelBody>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre de la empresa">
              <input name="companyName" defaultValue={draft.companyName} className={inputClass} />
            </Field>
            <Field label="Nombre de la asistente">
              <input name="assistantName" defaultValue={draft.assistantName} className={inputClass} />
            </Field>
          </div>
          <Field label="Instrucciones">
            <textarea name="instructions" rows={14} defaultValue={draft.instructions} className={`${inputClass} leading-relaxed`} />
          </Field>
        </PanelBody>
      </Panel>

      {draft.docs.length > 0 && (
        <Panel icon={<BookOpen />} title="Conocimiento" description="Se guardan como documentos nuevos (o reemplazan a los que tengan el mismo título).">
          <PanelBody>
            {draft.docs.map((d, i) => (
              <div key={i} className="space-y-2">
                <input name={`docTitle${i}`} defaultValue={d.title} aria-label="Título del documento" className={`${inputClass} font-medium`} />
                <textarea name={`docContent${i}`} rows={6} defaultValue={d.content} aria-label={`Contenido de ${d.title}`} className={`${inputClass} leading-relaxed`} />
              </div>
            ))}
          </PanelBody>
        </Panel>
      )}

      {draft.stages.length > 0 && (
        <Panel icon={<GitBranch />} title="Cuándo avanzar de etapa" description="Las etapas de tu funnel que atiende la IA. Las cambias después en Funnel y etiquetas.">
          <PanelBody>
            {draft.stages.map((s) => (
              <Field key={s.id} label={`Desde "${s.name}"`}>
                <textarea name={`stage_${s.id}`} rows={2} defaultValue={s.exitCriteria} className={inputClass} />
              </Field>
            ))}
          </PanelBody>
        </Panel>
      )}

      {state.error && <FormMessage>{state.error}</FormMessage>}
      <div className="flex flex-wrap justify-end gap-2">
        <IntentButton intent="back" variant="ghost">
          Cambiar respuestas
        </IntentButton>
        <IntentButton intent="draft" variant="secondary" pendingText="Redactando…">
          Redactar otra vez
        </IntentButton>
        <IntentButton intent="apply" variant="success" pendingText="Guardando…">
          Guardar configuración
        </IntentButton>
      </div>
    </form>
  );
}

function IntentButton({ intent, variant, pendingText, children }: { intent: string; variant: ButtonVariant; pendingText?: string; children: React.ReactNode }) {
  const { pending, data } = useFormStatus();
  const mine = pending && data?.get("intent") === intent;
  return (
    <button type="submit" name="intent" value={intent} disabled={pending} aria-busy={mine} formNoValidate={intent !== "draft"} className={buttonClass(variant)}>
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
