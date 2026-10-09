import { getAssistantSettings } from "@/lib/settings";
import { API_KEY_ENV, DEFAULT_MODEL, DEFAULT_SUMMARY_MODEL, getAiConfig } from "@/lib/ai/config";
import { listOpenRouterModels } from "@/lib/ai/models";
import { Card, Field, inputClass, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { saveAssistantAction } from "../actions";
import { AiForm } from "./ai-form";

export default async function AssistantSettingsPage() {
  const [s, config, models] = await Promise.all([getAssistantSettings(), getAiConfig(), listOpenRouterModels()]);
  const keys = {
    openrouter: Boolean(process.env[API_KEY_ENV.openrouter]),
    anthropic: Boolean(process.env[API_KEY_ENV.anthropic]),
  };
  return (
    <>
      <PageHeader title="Asistente IA" />
      <Card className="p-5">
        <form action={saveAssistantAction} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre de la asistente">
              <input name="assistantName" defaultValue={s.assistantName} className={inputClass} />
            </Field>
            <Field label="Nombre de la empresa">
              <input name="companyName" defaultValue={s.companyName} className={inputClass} />
            </Field>
          </div>
          <Field
            label="Instrucciones"
            hint="Tono, qué preguntar para calificar, qué no decir, cuándo derivar. La información de productos y políticas va en la base de conocimiento y el inventario."
          >
            <textarea name="instructions" rows={10} defaultValue={s.instructions} className={inputClass} />
          </Field>
          <SubmitButton>Guardar</SubmitButton>
        </form>
      </Card>
      <h2 className="mb-3 mt-8 text-base font-semibold text-slate-900">Modelo de IA</h2>
      <Card className="p-5">
        <AiForm config={config} models={models} defaults={DEFAULT_MODEL} summaryDefaults={DEFAULT_SUMMARY_MODEL} keys={keys} />
      </Card>
    </>
  );
}
