"use client";

import { useActionState } from "react";
import type { Channel } from "@prisma/client";
import { Plus, Trash2 } from "lucide-react";
import { Field, FormMessage, inputClass } from "@/components/ui";
import { Chip, PanelBody, PanelFooter, ToggleRow } from "@/components/settings-ui";
import { SubmitButton } from "@/components/submit-button";
import { CHANNEL_LABEL } from "@/lib/labels";
import { createVariantAction, deleteVariantAction, updateVariantAction } from "./actions";

type Variant = {
  id: string;
  name: string;
  assistantName: string | null;
  instructions: string;
  weight: number;
  active: boolean;
};

function VariantFields({ variant, defaultAssistant }: { variant?: Variant; defaultAssistant: string }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)]">
        <Field label="Nombre de la variante">
          <input name="name" required defaultValue={variant?.name} placeholder="Ej. Más directa" className={inputClass} />
        </Field>
        <Field label="Nombre de la asistente" hint={`Vacío: ${defaultAssistant}.`}>
          <input name="assistantName" defaultValue={variant?.assistantName ?? ""} placeholder={defaultAssistant} className={inputClass} />
        </Field>
        <Field label="Peso" hint="Proporción de leads nuevos.">
          <input name="weight" type="number" min={0} max={100} required defaultValue={variant?.weight ?? 50} className={inputClass} />
        </Field>
      </div>
      <Field label="Instrucciones de esta variante" hint="Se suman a las de la asistente y del embudo. Vacío: la asistente tal cual (sirve como grupo de control).">
        <textarea
          name="instructions"
          rows={4}
          defaultValue={variant?.instructions}
          placeholder="Ej.: Ofrece agendar una visita en el primer mensaje."
          className={inputClass}
        />
      </Field>
      <ToggleRow name="active" defaultChecked={variant?.active ?? true} title="Activa" description="Recibe leads nuevos del canal." />
    </>
  );
}

export function NewVariantForm({ channels, defaultAssistant }: { channels: Channel[]; defaultAssistant: string }) {
  const [error, action] = useActionState(createVariantAction, null);
  return (
    <form action={action}>
      <PanelBody>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium text-slate-800">Canal</legend>
          <div className="flex flex-wrap gap-2">
            {channels.map((c, i) => (
              <Chip key={c} type="radio" name="channel" value={c} defaultChecked={i === 0} required>
                {CHANNEL_LABEL[c]}
              </Chip>
            ))}
          </div>
        </fieldset>
        <VariantFields defaultAssistant={defaultAssistant} />
      </PanelBody>
      <PanelFooter note={error && <FormMessage>{error}</FormMessage>}>
        <SubmitButton>
          <Plus aria-hidden />
          Crear variante
        </SubmitButton>
      </PanelFooter>
    </form>
  );
}

export function VariantForm({ variant, defaultAssistant }: { variant: Variant; defaultAssistant: string }) {
  const [error, action] = useActionState(updateVariantAction.bind(null, variant.id), null);
  const [deleteError, remove] = useActionState(deleteVariantAction.bind(null, variant.id), null);
  return (
    <div className="space-y-4">
      <form action={action} className="space-y-4">
        <VariantFields variant={variant} defaultAssistant={defaultAssistant} />
        <div className="flex flex-wrap items-center justify-end gap-3">
          {error && <FormMessage>{error}</FormMessage>}
          <SubmitButton>Guardar cambios</SubmitButton>
        </div>
      </form>
      <form action={remove} className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
        <SubmitButton variant="ghost-danger" size="sm" confirm={`¿Borrar la variante "${variant.name}"?`} pendingText="Borrando…">
          <Trash2 aria-hidden />
          Borrar variante
        </SubmitButton>
        {deleteError && <FormMessage>{deleteError}</FormMessage>}
      </form>
    </div>
  );
}
