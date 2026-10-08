"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { CircleX, FlaskConical, LoaderCircle, Trophy } from "lucide-react";
import { Button, FormMessage, inputClass } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { closeLeadAction, sendAsContactAction } from "./actions";

function ContactSubmit() {
  const { pending } = useFormStatus();
  return (
    <>
      {pending && (
        <p role="status" className="flex items-center gap-1.5 text-xs text-brand-800">
          <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
          La asistente está escribiendo…
        </p>
      )}
      <Button type="submit" variant="secondary" disabled={pending} aria-busy={pending}>
        Enviar como cliente
      </Button>
    </>
  );
}

export function ContactComposer({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [error, action] = useActionState(async (prev: string | null, form: FormData) => {
    try {
      return await sendAsContactAction(leadId, prev, form);
    } catch (err) {
      // La respuesta de la IA puede tardar más que el límite del servidor (o caerse la red):
      // en vez de romper la página, avisamos y traemos lo que alcanzó a guardarse.
      console.error(err);
      router.refresh();
      return "La asistente no alcanzó a responder. Si no aparece su mensaje, vuelve a escribirle.";
    }
  }, null);
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={formRef}
      action={(fd) => {
        action(fd);
        formRef.current?.reset();
      }}
      className="space-y-2 rounded-xl border border-dashed border-brand-300 bg-brand-50/60 p-3"
    >
      <label htmlFor="as-contact" className="flex items-center gap-1.5 text-xs font-semibold text-brand-800">
        <FlaskConical aria-hidden className="size-3.5" />
        Simulador: escribe como si fueras el cliente
      </label>
      <textarea id="as-contact" name="body" rows={2} required placeholder="Hola, quiero información sobre…" className={inputClass} />
      <div className="flex flex-wrap items-center justify-end gap-3">
        {error && (
          <div className="mr-auto">
            <FormMessage>{error}</FormMessage>
          </div>
        )}
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
          <Trophy aria-hidden />
          Ganado
        </Button>
        <Button variant="danger" className="flex-1" onClick={() => setMode("LOST")}>
          <CircleX aria-hidden />
          Perdido
        </Button>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="outcome" value={mode} />
      {mode === "WON" ? (
        <input name="amount" inputMode="numeric" aria-label="Monto de la venta (opcional)" placeholder="Monto de la venta (opcional)" autoFocus className={inputClass} />
      ) : (
        <input name="lostReason" required aria-label="Motivo de pérdida" placeholder="Motivo de pérdida" autoFocus className={inputClass} />
      )}
      {error && <FormMessage>{error}</FormMessage>}
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
