import { getAssistantSettings } from "@/lib/settings";
import { Card, Field, inputClass, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { saveAssistantAction } from "../actions";

export default async function AssistantSettingsPage() {
  const s = await getAssistantSettings();
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
    </>
  );
}
