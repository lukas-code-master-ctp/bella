import { DEFAULT_ASSISTANT, getAssistantSettings } from "@/lib/settings";
import { PageHeader } from "@/components/ui";
import { SetupWizard } from "./wizard";

export default async function AssistantSetupPage() {
  const s = await getAssistantSettings();
  return (
    <>
      <PageHeader
        title="Presenta a tu asistente"
        description="Responde estas preguntas y la IA redacta las instrucciones de tu asistente, un primer documento de conocimiento y cuándo avanzar a cada lead de etapa. Revisas todo antes de guardar."
      />
      <SetupWizard
        companyName={s.companyName === DEFAULT_ASSISTANT.companyName ? "" : s.companyName}
        assistantName={s.assistantName}
      />
    </>
  );
}
