"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";
import { Field, FormMessage, inputClass } from "@/components/ui";
import { PanelBody, PanelFooter } from "@/components/settings-ui";
import { SubmitButton } from "@/components/submit-button";
import { saveInventoryAction } from "../../actions";

export function InventoryForm({ sheetUrl }: { sheetUrl: string }) {
  const [message, action] = useActionState(saveInventoryAction, null);
  return (
    <form action={action}>
      <PanelBody>
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
      </PanelBody>
      <PanelFooter note={message && <FormMessage tone="neutral">{message}</FormMessage>}>
        <SubmitButton pendingText="Sincronizando…">
          <RefreshCw aria-hidden />
          Guardar y sincronizar
        </SubmitButton>
      </PanelFooter>
    </form>
  );
}
