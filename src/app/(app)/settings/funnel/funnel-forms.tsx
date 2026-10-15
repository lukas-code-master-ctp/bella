"use client";

import { useActionState } from "react";
import type { Channel } from "@prisma/client";
import { Plus, Trash2 } from "lucide-react";
import { Field, FormMessage, inputClass } from "@/components/ui";
import { Chip, PanelBody, PanelFooter } from "@/components/settings-ui";
import { SubmitButton } from "@/components/submit-button";
import { CHANNEL_LABEL } from "@/lib/labels";
import { createFunnelAction, deleteFunnelAction, updateFunnelAction } from "../actions";
import { isSaved, savedToast, withToast } from "@/components/toast";

const CHANNELS = Object.keys(CHANNEL_LABEL) as Channel[];

export function NewFunnelForm() {
  const [error, action] = useActionState(createFunnelAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input name="name" required aria-label="Nombre del nuevo embudo" placeholder="Nuevo embudo (ej. Venta online)" className={`${inputClass} sm:max-w-xs`} />
      <SubmitButton variant="secondary" pendingText="Creando…">
        <Plus aria-hidden />
        Crear embudo
      </SubmitButton>
      {error && <FormMessage>{error}</FormMessage>}
    </form>
  );
}

type FunnelData = {
  id: string;
  name: string;
  channels: Channel[];
  assistantName: string | null;
  instructions: string | null;
};

export function FunnelForm({ funnel, defaultAssistant, removable }: { funnel: FunnelData; defaultAssistant: string; removable: boolean }) {
  const [message, action] = useActionState(withToast(updateFunnelAction.bind(null, funnel.id), savedToast), null);
  const [deleteError, remove] = useActionState(deleteFunnelAction.bind(null, funnel.id), null);
  return (
    <>
      <form action={action}>
        <PanelBody>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre del embudo">
              <input name="name" required defaultValue={funnel.name} className={inputClass} />
            </Field>
            <Field label="Nombre de la asistente" hint={`Vacío: ${defaultAssistant}, como en Configuración → Asistente.`}>
              <input name="assistantName" defaultValue={funnel.assistantName ?? ""} placeholder={defaultAssistant} className={inputClass} />
            </Field>
          </div>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium text-slate-800">Canales que entran a este embudo</legend>
            <div className="flex flex-wrap gap-2">
              {CHANNELS.map((c) => (
                <Chip key={c} name="channels" value={c} defaultChecked={funnel.channels.includes(c)}>
                  {CHANNEL_LABEL[c]}
                </Chip>
              ))}
            </div>
            <p className="text-xs text-slate-600">Los leads nuevos de un canal sin embudo van al primero de la lista.</p>
          </fieldset>
          <Field label="Instrucciones de la asistente en este embudo" hint="Se suman a las instrucciones generales: qué vende esta línea, a quién y cómo.">
            <textarea name="instructions" rows={4} defaultValue={funnel.instructions ?? ""} className={inputClass} />
          </Field>
        </PanelBody>
        <PanelFooter note={message && !isSaved(message) && <FormMessage>{message}</FormMessage>}>
          <SubmitButton pendingText="Guardando…">Guardar embudo</SubmitButton>
        </PanelFooter>
      </form>
      {removable && (
        <form action={remove} className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-5 py-3">
          <SubmitButton variant="ghost-danger" size="sm" confirm={`¿Borrar el embudo "${funnel.name}" y sus etapas?`} pendingText="Borrando…">
            <Trash2 aria-hidden />
            Borrar embudo
          </SubmitButton>
          {deleteError && <FormMessage>{deleteError}</FormMessage>}
        </form>
      )}
    </>
  );
}
