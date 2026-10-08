"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, inputClass } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { closeLeadAction, sendAsContactAction } from "./actions";

function ContactSubmit() {
  const { pending } = useFormStatus();
  return (
    <>
      {pending && <p className="text-xs text-slate-500">La asistente está escribiendo…</p>}
      <Button type="submit" variant="secondary" disabled={pending}>
        Enviar como cliente
      </Button>
    </>
  );
}

export function ContactComposer({ leadId }: { leadId: string }) {
  const [error, action] = useActionState(sendAsContactAction.bind(null, leadId), null);
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={formRef}
      action={(fd) => {
        action(fd);
        formRef.current?.reset();
      }}
      className="space-y-2 rounded-md border border-dashed border-brand-500/50 bg-brand-50 p-3"
    >
      <p className="text-xs font-medium text-brand-700">Simulador: escribe como si fueras el cliente</p>
      <textarea name="body" rows={2} required placeholder="Hola, quiero información sobre…" className={inputClass} />
      <div className="flex items-center justify-end gap-3">
        {error && <p className="mr-auto text-xs text-rose-600">{error}</p>}
        <ContactSubmit />
      </div>
    </form>
  );
}

export function CloseLeadForm({ leadId }: { leadId: string }) {
  const [mode, setMode] = useState<"WON" | "LOST" | null>(null);
  const [error, action] = useActionState(closeLeadAction.bind(null, leadId), null);
  if (!mode) {
    return (
      <div className="flex gap-2">
        <Button variant="success" className="flex-1" onClick={() => setMode("WON")}>
          Ganado
        </Button>
        <Button variant="danger" className="flex-1" onClick={() => setMode("LOST")}>
          Perdido
        </Button>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="outcome" value={mode} />
      {mode === "WON" ? (
        <input name="amount" inputMode="numeric" placeholder="Monto de la venta (opcional)" className={inputClass} />
      ) : (
        <input name="lostReason" required placeholder="Motivo de pérdida" className={inputClass} />
      )}
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <div className="flex gap-2">
        <SubmitButton variant={mode === "WON" ? "success" : "danger"} className="flex-1">
          Marcar {mode === "WON" ? "ganado" : "perdido"}
        </SubmitButton>
        <Button variant="ghost" type="button" onClick={() => setMode(null)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

/** Mantiene el chat desplazado al último mensaje. */
export function ScrollToBottom({ dep }: { dep: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.scrollIntoView({ block: "end" }), [dep]);
  return <div ref={ref} />;
}
