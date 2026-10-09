"use client";

import { useActionState, useCallback, useEffect, useOptimistic, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Activity, Bot, CircleX, FlaskConical, LoaderCircle, MessageCircle, RefreshCw, Send, Trophy } from "lucide-react";
import { Button, EmptyState, FormMessage, inputClass } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { closeLeadAction, refreshInsightsAction, sendAsContactAction, sendAsUserAction } from "./actions";
import { ActivityPanel } from "./activity-panel";

export type ChatMessage = {
  id: string;
  author: "CONTACT" | "AI" | "USER";
  authorName: string;
  body: string;
  /** Hora ya formateada en el servidor (evita diferencias de zona horaria al hidratar). */
  time: string;
  pending?: boolean;
};

/** Enter envía el formulario; Shift+Enter agrega una línea. */
function submitOnEnter(e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) {
  if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
  e.preventDefault();
  if (e.currentTarget.value.trim()) e.currentTarget.form?.requestSubmit();
}

/**
 * Conversación del lead con los formularios para escribir. Los mensajes enviados aparecen al
 * tiro (optimistas) y se reemplazan por los guardados cuando el servidor termina de responder.
 */
export function LeadChat({
  leadId,
  messages,
  contactName,
  userName,
  simulator,
}: {
  leadId: string;
  messages: ChatMessage[];
  contactName: string;
  userName: string;
  simulator: boolean;
}) {
  const [shown, addPending] = useOptimistic(messages, (list, m: ChatMessage) => [...list, m]);
  const [inspected, setInspected] = useState<ChatMessage | null>(null);
  const closeInspector = useCallback(() => setInspected(null), []);
  const pending = (author: ChatMessage["author"], body: string): ChatMessage => ({
    id: `pending-${Date.now()}`,
    author,
    authorName: author === "CONTACT" ? contactName : userName,
    body,
    time: "Enviando…",
    pending: true,
  });

  return (
    <>
      <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 px-3 py-4 sm:px-6" aria-live="polite">
        {shown.length === 0 && (
          <EmptyState icon={<MessageCircle />} title="Aún no hay mensajes">
            Cuando el cliente escriba, la conversación aparecerá aquí.
          </EmptyState>
        )}
        {shown.map((m) => (
          <Bubble key={m.id} message={m} onInspect={m.author === "AI" && !m.pending ? () => setInspected(m) : undefined} />
        ))}
        <ScrollToBottom dep={shown.length} />
      </div>

      <div className="space-y-3 border-t border-slate-200 bg-white p-3 sm:p-4">
        {simulator && (
          <ContactComposer
            leadId={leadId}
            onSend={(body) => {
              addPending(pending("CONTACT", body));
            }}
          />
        )}
        <UserComposer
          leadId={leadId}
          onSend={(body) => {
            addPending(pending("USER", body));
          }}
        />
      </div>

      <ActivityPanel leadId={leadId} message={inspected} onClose={closeInspector} />
    </>
  );
}

/** Burbuja del chat. Las de la IA se pueden abrir en el monitor de actividad. */
function Bubble({ message: m, onInspect }: { message: ChatMessage; onInspect?: () => void }) {
  const fromContact = m.author === "CONTACT";
  const Wrapper = onInspect ? "button" : "div";
  return (
    <div className={`flex ${fromContact ? "justify-start" : "justify-end"}`}>
      <Wrapper
        {...(onInspect
          ? { type: "button" as const, onClick: onInspect, title: "Ver cómo la IA construyó este mensaje" }
          : {})}
        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-left text-sm leading-relaxed shadow-xs sm:max-w-[70%] ${
          onInspect ? "cursor-pointer transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600" : ""
        } ${
          fromContact
            ? "rounded-bl-md border border-slate-200 bg-white text-slate-800"
            : m.author === "AI"
              ? "rounded-br-md bg-brand-600 text-white"
              : "rounded-br-md bg-emerald-700 text-white"
        } ${m.pending ? "opacity-70" : ""}`}
      >
        <span className={`mb-0.5 flex items-center gap-1 text-[11px] font-semibold ${fromContact ? "text-slate-600" : "text-white/85"}`}>
          {m.author === "AI" && <Bot aria-hidden className="size-3.5" />}
          {m.authorName}
          {onInspect && (
            <>
              <Activity aria-hidden className="ml-auto size-3.5 pl-0.5" />
              <span className="sr-only">(ver actividad)</span>
            </>
          )}
        </span>
        <span className="block whitespace-pre-wrap">{m.body}</span>
        <span className={`mt-1 block text-right text-[11px] tabular-nums ${fromContact ? "text-slate-500" : "text-white/80"}`}>{m.time}</span>
      </Wrapper>
    </div>
  );
}

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

function ContactComposer({ leadId, onSend }: { leadId: string; onSend: (body: string) => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={formRef}
      action={async (fd) => {
        const body = String(fd.get("body") ?? "").trim();
        if (!body) return;
        onSend(body);
        formRef.current?.reset();
        setError(null);
        try {
          setError(await sendAsContactAction(leadId, null, fd));
        } catch (err) {
          // La respuesta de la IA puede tardar más que el límite del servidor (o caerse la red):
          // en vez de romper la página, avisamos y traemos lo que alcanzó a guardarse.
          console.error(err);
          router.refresh();
          setError("La asistente no alcanzó a responder. Si no aparece su mensaje, vuelve a escribirle.");
        }
      }}
      className="space-y-2 rounded-xl border border-dashed border-brand-300 bg-brand-50/60 p-3"
    >
      <label htmlFor="as-contact" className="flex items-center gap-1.5 text-xs font-semibold text-brand-800">
        <FlaskConical aria-hidden className="size-3.5" />
        Simulador: escribe como si fueras el cliente
      </label>
      <textarea
        id="as-contact"
        name="body"
        rows={2}
        required
        placeholder="Hola, quiero información sobre…"
        onKeyDown={submitOnEnter}
        className={inputClass}
      />
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

function UserComposer({ leadId, onSend }: { leadId: string; onSend: (body: string) => void }) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={formRef}
      action={async (fd) => {
        const body = String(fd.get("body") ?? "").trim();
        if (!body) return;
        onSend(body);
        formRef.current?.reset();
        await sendAsUserAction(leadId, fd);
      }}
      className="flex gap-2"
    >
      <label htmlFor="reply" className="sr-only">
        Responder como ejecutivo
      </label>
      <input id="reply" name="body" required placeholder="Responder como ejecutivo (pausa la IA)" className={inputClass} />
      <SubmitButton pendingText="Enviando…">
        <Send aria-hidden />
        <span className="hidden sm:inline">Enviar</span>
      </SubmitButton>
    </form>
  );
}

/** Recalcula a pedido el resumen y el puntaje del lead. */
export function RefreshInsightsForm({ leadId, hasSummary }: { leadId: string; hasSummary: boolean }) {
  const [error, action] = useActionState(refreshInsightsAction.bind(null, leadId), null);
  return (
    <form action={action} className="mt-3 space-y-2">
      <SubmitButton variant="secondary" size="sm" pendingText="Analizando…">
        <RefreshCw aria-hidden />
        {hasSummary ? "Actualizar" : "Generar resumen"}
      </SubmitButton>
      {error && <FormMessage>{error}</FormMessage>}
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
function ScrollToBottom({ dep }: { dep: number }) {
  const ref = useRef<HTMLDivElement>(null);
  // Con llaves: en Chrome reciente scrollIntoView devuelve una Promise, y si el efecto la
  // retorna, React la llama como función de limpieza al desmontar ("u is not a function").
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "end" });
  }, [dep]);
  return <div ref={ref} />;
}
