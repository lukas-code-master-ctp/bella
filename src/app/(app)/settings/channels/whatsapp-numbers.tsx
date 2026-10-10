"use client";

import { useActionState } from "react";
import { Plus } from "lucide-react";
import { Field, FormMessage, inputClass } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { addWhatsAppNumberAction } from "../actions";

export type FunnelOption = { id: string; name: string };

export function FunnelSelect({ funnels, defaultValue, label }: { funnels: FunnelOption[]; defaultValue?: string | null; label: string }) {
  return (
    <select name="funnelId" aria-label={label} defaultValue={defaultValue ?? ""} className={inputClass}>
      <option value="">Embudo del canal WhatsApp</option>
      {funnels.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
        </option>
      ))}
    </select>
  );
}

export function AddWhatsAppNumberForm({ funnels }: { funnels: FunnelOption[] }) {
  const [error, action] = useActionState(addWhatsAppNumberAction, null);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
      <Field label="Id del número" hint="WhatsApp → Configuración de la API.">
        <input name="phoneNumberId" required inputMode="numeric" placeholder="Ej. 123456789012345" className={inputClass} />
      </Field>
      <Field label="Nombre" hint="Para reconocerlo en Bella.">
        <input name="label" placeholder="Ej. Ventas online" className={inputClass} />
      </Field>
      <Field label="Embudo de sus leads nuevos" hint="Vacío: el del canal WhatsApp.">
        <FunnelSelect funnels={funnels} label="Embudo" />
      </Field>
      <SubmitButton variant="secondary" pendingText="Revisando con Meta…">
        <Plus aria-hidden />
        Agregar
      </SubmitButton>
      {error && (
        <div className="sm:col-span-4">
          <FormMessage>{error}</FormMessage>
        </div>
      )}
    </form>
  );
}
