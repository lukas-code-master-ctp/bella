import Link from "next/link";
import { Bot, Cpu, Sparkles, Wallet } from "lucide-react";
import { getAssistantSettings } from "@/lib/settings";
import { credentials } from "@/lib/credentials";
import { DEFAULT_MODEL, DEFAULT_SUMMARY_MODEL, getAiConfig } from "@/lib/ai/config";
import { getOpenRouterKeyInfo, listOpenRouterModels } from "@/lib/ai/models";
import { Avatar, buttonClass, Field, inputClass, PageHeader } from "@/components/ui";
import { Panel, PanelBody, PanelFooter } from "@/components/settings-ui";
import { SubmitButton } from "@/components/submit-button";
import { saveAssistantAction } from "../actions";
import { aiSpendSummary } from "@/lib/domain/ai-usage";
import { AiForm } from "./ai-form";
import { AiSpend } from "./ai-spend";

export default async function AssistantSettingsPage() {
  const [s, config, models, keyInfo, spend, creds] = await Promise.all([
    getAssistantSettings(),
    getAiConfig(),
    listOpenRouterModels(),
    getOpenRouterKeyInfo(),
    aiSpendSummary(),
    credentials(),
  ]);
  const keys = {
    openrouter: Boolean(creds.OPENROUTER_API_KEY),
    anthropic: Boolean(creds.ANTHROPIC_API_KEY),
  };
  return (
    <div className="space-y-6">
      <PageHeader title="Asistente IA" description="Quién es la asistente, cómo habla y con qué modelo piensa.">
        <Link href="/settings/assistant/setup" className={buttonClass("secondary")}>
          <Sparkles aria-hidden />
          Redactar con IA
        </Link>
      </PageHeader>

      <Panel
        icon={<Bot />}
        title="Identidad e instrucciones"
        description="Así se presenta la asistente ante tus clientes."
        aside={
          <span className="hidden items-center gap-2 rounded-full bg-slate-50 py-1 pl-1 pr-3 text-sm font-medium text-slate-700 ring-1 ring-slate-200 sm:inline-flex">
            <Avatar name={s.assistantName} size="sm" />
            {s.assistantName}
          </span>
        }
      >
        <form action={saveAssistantAction}>
          <PanelBody>
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
              hint="Tono, qué preguntar para calificar, qué no decir, cuándo derivar. La información de productos y políticas va en Conocimiento."
            >
              <textarea name="instructions" rows={12} defaultValue={s.instructions} className={`${inputClass} leading-relaxed`} />
            </Field>
          </PanelBody>
          <PanelFooter note={`${s.instructions.length.toLocaleString("es-CL")} caracteres guardados`}>
            <SubmitButton toast="Cambios guardados">Guardar</SubmitButton>
          </PanelFooter>
        </form>
      </Panel>

      <Panel icon={<Cpu />} title="Modelo de IA" description="El proveedor y el modelo que usa la asistente para conversar y para resumir.">
        <AiForm
          config={config}
          models={models}
          defaults={DEFAULT_MODEL}
          summaryDefaults={DEFAULT_SUMMARY_MODEL}
          keys={keys}
          keyInfo={keyInfo}
        />
      </Panel>

      <Panel icon={<Wallet />} title="Consumo" description="Gasto en IA por período, comparado con el período anterior equivalente.">
        <AiSpend rows={spend} />
      </Panel>
    </div>
  );
}
