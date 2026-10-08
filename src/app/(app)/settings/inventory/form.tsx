"use client";

import { useActionState } from "react";
import { Field, FormMessage, inputClass } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { saveInventoryAction } from "../actions";

export function InventoryForm({ sheetUrl }: { sheetUrl: string }) {
  const [message, action] = useActionState(saveInventoryAction, null);
  return (
    <form action={action} className="space-y-3">
      <Field
        label="Enlace de la planilla de Google Sheets"
        hint='Compártela como "Cualquier persona con el enlace: Lector". Se lee la pestaña del enlace (gid). La primera fila son los nombres de columna.'
      >
        <input
          name="sheetUrl"
          required
          defaultValue={sheetUrl}
          placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=0"
          className={inputClass}
        />
      </Field>
      <div className="flex items-center gap-3">
        <SubmitButton pendingText="Sincronizando…">Guardar y sincronizar</SubmitButton>
        {message && <FormMessage tone="neutral">{message}</FormMessage>}
      </div>
    </form>
  );
}
