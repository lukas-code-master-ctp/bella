"use client";

import { useActionState } from "react";
import { Bot } from "lucide-react";
import { FormMessage, inputClass } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { saveFieldsAction } from "./actions";

export type LeadField = {
  id: string;
  name: string;
  options: string[] | null;
  /** Valor ya formateado para mostrar, o vacío. */
  value: string;
  byAi: boolean;
};

/** Campos del cliente en la ficha del lead: los llena la IA y el ejecutivo los corrige aquí. */
export function LeadFieldsForm({ leadId, fields }: { leadId: string; fields: LeadField[] }) {
  const [message, action] = useActionState(saveFieldsAction.bind(null, leadId), null);
  // La key con los valores guardados reinicia los inputs cuando la IA o alguien más los cambia.
  const key = fields.map((f) => f.value).join("\u0000");
  return (
    <form key={key} action={action} className="space-y-2.5">
      {fields.map((f) => (
        <label key={f.id} className="block">
          <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-700">
            {f.name}
            {f.byAi && f.value && (
              <span title="Lo guardó la IA" className="inline-flex items-center gap-0.5 text-[11px] font-normal text-slate-500">
                <Bot aria-hidden className="size-3" />
                IA
              </span>
            )}
          </span>
          {f.options ? (
            <select name={f.id} defaultValue={f.value} className={inputClass}>
              <option value="">Sin dato</option>
              {f.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <input name={f.id} defaultValue={f.value} placeholder="Sin dato" autoComplete="off" className={inputClass} />
          )}
        </label>
      ))}
      <div className="flex items-center gap-3 pt-1">
        <SubmitButton variant="secondary">Guardar datos</SubmitButton>
        {message && <FormMessage tone={message === "Guardado." ? "neutral" : "danger"}>{message}</FormMessage>}
      </div>
    </form>
  );
}
