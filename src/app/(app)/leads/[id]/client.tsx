"use client";

import { useActionState, useCallback, useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Activity, Ban, BellRing, Bot, Check, CheckCheck, CircleAlert, CircleX, Clock, FlaskConical, MessageCircle, Mic, RefreshCw, Send, Trophy } from "lucide-react";
import { Button, EmptyState, FormMessage, TypingDots, inputClass } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { blockContactAction, closeLeadAction, refreshInsightsAction, sendAsContactAction, sendAsUserAction, sendFollowUpNowAction } from "./actions";
import { ActivityPanel } from "./activity-panel";
import { MicButton, RecordingBar, useVoiceRecorder } from "./voice-recorder";

export type ChatMessage = {
  id: string;
  author: "CONTACT" | "AI" | "USER";
  authorName: string;
  body: string;
  /** Nota de voz: archivo y transcripción (null si no se pudo transcribir). */
  audio?: { url: string; transcript: string | null };
  /** Hora ya formateada en el servidor (evita diferencias de zona horaria al hidratar). */
  time: string;
  pending?: boolean;
  /** Entrega por WhatsApp de un mensaje enviado (no existe en el simulador). */
  delivery?: { status: string; error: string | null };
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
  blocked = false,
}: {
  leadId: string;
  messages: ChatMessage[];
  contactName: string;
  userName: string;
  simulator: boolean;
  /** Contacto bloqueado: no se le escribe ni se simula que escribe. */
  blocked?: boolean;
}) {
  const [shown, addPending] = useOptimistic(messages, (list, m: ChatMessage) => [...list, m]);
  const [inspected, setInspected] = useState<ChatMessage | null>(null);
  // Optimista: se ve mientras dura el envío y se apaga solo cuando la acción termina.
  const [typing, setTyping] = useOptimistic(false);
  const entersAnimated = useEntranceTracker(messages);
  const closeInspector = useCallback(() => setInspected(null), []);
  const pending = (author: ChatMessage["author"], body: string, audio?: ChatMessage["audio"]): ChatMessage => ({
    id: `pending-${author}-${Date.now()}`,
    author,
    authorName: author === "CONTACT" ? contactName : userName,
    body,
    ...(audio ? { audio } : {}),
    time: "Enviando…",
    pending: true,
  });

  return (
    <>
      <div className="relative flex-1 space-y-3 overflow-y-auto bg-slate-50 px-3 py-4 sm:px-6" aria-live="polite">
        {shown.length === 0 && (
          <EmptyState icon={<MessageCircle />} title="Aún no hay mensajes">
            Cuando el cliente escriba, la conversación aparecerá aquí.
          </EmptyState>
        )}
        {shown.map((m) => (
          <Bubble
            key={m.id}
            message={m}
            animate={entersAnimated(m)}
            onInspect={m.author === "AI" && !m.pending ? () => setInspected(m) : undefined}
          />
        ))}
        {typing && <TypingBubble />}
        <ScrollToBottom dep={shown.length + (typing ? 1 : 0)} />
      </div>

      {blocked ? (
        <p className="flex items-center gap-2 border-t border-slate-200 bg-white p-4 text-sm text-slate-600">
          <Ban aria-hidden className="size-4 shrink-0 text-rose-600" />
          Contacto bloqueado: sus mensajes nuevos se descartan y nadie le responde.
        </p>
      ) : (
      <div className="space-y-3 border-t border-slate-200 bg-white p-3 sm:p-4">
        {simulator && (
          <ContactComposer
            leadId={leadId}
            onSend={(body, audioUrl) => {
              // Igual que en el servidor: primero la nota de voz y después el texto que la acompaña.
              if (audioUrl) addPending(pending("CONTACT", "", { url: audioUrl, transcript: null }));
              if (body) addPending(pending("CONTACT", body));
              setTyping(true);
            }}
          />
        )}
        <UserComposer
          leadId={leadId}
          onSend={(body, audioUrl) => {
            if (audioUrl) addPending(pending("USER", "", { url: audioUrl, transcript: null }));
            if (body) addPending(pending("USER", body));
          }}
        />
      </div>
      )}

      <ActivityPanel leadId={leadId} message={inspected} onClose={closeInspector} />
    </>
  );
}

/** Firma de un mensaje para reconocer al guardado que reemplaza al optimista (cambia el id). */
const signature = (m: ChatMessage) => `${m.author}:${m.audio ? "audio:" : ""}${m.body}`;

/**
 * Decide qué burbujas entran animadas: solo las que llegan después de abrir la conversación,
 * y una sola vez (el mensaje guardado que reemplaza al optimista no se vuelve a animar).
 * La decisión se fija la primera vez que se ve cada id, para no cortar la animación a medias.
 */
function useEntranceTracker(initial: ChatMessage[]) {
  const [seen] = useState(() => new Set(initial.map(signature)));
  const [decided] = useState(() => new Map<string, boolean>());
  return (m: ChatMessage) => {
    let animate = decided.get(m.id);
    if (animate === undefined) {
      animate = !seen.has(signature(m));
      decided.set(m.id, animate);
      seen.add(signature(m));
    }
    return animate;
  };
}

/** Burbuja del chat. Las de la IA se pueden abrir en el monitor de actividad. */
function Bubble({ message: m, animate, onInspect }: { message: ChatMessage; animate?: boolean; onInspect?: () => void }) {
  const fromContact = m.author === "CONTACT";
  const Wrapper = onInspect ? "button" : "div";
  return (
    <div
      className={`flex ${fromContact ? "justify-start" : "justify-end"} ${
        animate ? `animate-message-in ${fromContact ? "origin-bottom-left" : "origin-bottom-right"}` : ""
      }`}
    >
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
        {m.audio && <VoiceNote audio={m.audio} pending={m.pending} />}
        {m.body && <span className="block whitespace-pre-wrap">{m.body}</span>}
        <span className={`mt-1 flex items-center justify-end gap-1 text-[11px] tabular-nums ${fromContact ? "text-slate-500" : "text-white/80"}`}>
          {m.time}
          {m.delivery && <DeliveryMark status={m.delivery.status} />}
        </span>
        {m.delivery?.status === "FAILED" && (
          <span className="mt-1.5 flex gap-1 rounded-lg bg-white/95 px-2 py-1 text-[12px] font-medium text-red-700">
            <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            No se entregó: {m.delivery.error ?? "WhatsApp no pudo enviarlo."}
          </span>
        )}
      </Wrapper>
    </div>
  );
}

const DELIVERY: Record<string, { label: string; icon: React.ReactNode }> = {
  SENDING: { label: "Enviando", icon: <Clock aria-hidden className="size-3.5" /> },
  SENT: { label: "Enviado", icon: <Check aria-hidden className="size-3.5" /> },
  DELIVERED: { label: "Entregado", icon: <CheckCheck aria-hidden className="size-3.5" /> },
  READ: { label: "Leído", icon: <CheckCheck aria-hidden className="size-3.5 text-sky-200" /> },
  FAILED: { label: "No entregado", icon: <CircleAlert aria-hidden className="size-3.5 text-red-200" /> },
};

/** Ticks de WhatsApp: enviado, entregado, leído o fallido. */
function DeliveryMark({ status }: { status: string }) {
  const d = DELIVERY[status];
  if (!d) return null;
  return (
    <span title={d.label} className="inline-flex">
      {d.icon}
      <span className="sr-only">{d.label}</span>
    </span>
  );
}

/** Burbuja de la asistente con los tres puntos mientras prepara su respuesta. */
function TypingBubble() {
  return (
    <div role="status" className="flex origin-bottom-right animate-message-in justify-end">
      <span className="sr-only">La asistente está escribiendo…</span>
      <span className="flex h-10 items-center rounded-2xl rounded-br-md bg-brand-600 px-4 text-white/90 shadow-xs">
        <TypingDots />
      </span>
    </div>
  );
}

/** Nota de voz (del cliente o del ejecutivo): reproductor y su transcripción. */
function VoiceNote({ audio, pending }: { audio: NonNullable<ChatMessage["audio"]>; pending?: boolean }) {
  return (
    <span className="block space-y-1.5">
      <audio controls preload="none" src={audio.url} className="h-10 w-64 max-w-full">
        <a href={audio.url}>Descargar la nota de voz</a>
      </audio>
      <span className="block rounded-lg bg-slate-50 px-2.5 py-1.5 text-[13px] text-slate-700">
        <span className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-slate-500">
          <Mic aria-hidden className="size-3" />
          Transcripción
        </span>
        {pending ? (
          <span className="italic text-slate-500">Transcribiendo…</span>
        ) : audio.transcript ? (
          <span className="block whitespace-pre-wrap">{audio.transcript}</span>
        ) : (
          <span className="italic text-slate-500">No se pudo transcribir este audio.</span>
        )}
      </span>
    </span>
  );
}

function ContactSubmit({ busy }: { busy: boolean }) {
  const { pending: submitting } = useFormStatus();
  const pending = submitting || busy;
  // El aviso "escribiendo…" va como burbuja en la conversación (TypingBubble).
  return (
    <Button type="submit" variant="secondary" disabled={pending} aria-busy={pending}>
      Enviar como cliente
    </Button>
  );
}

function ContactComposer({
  leadId,
  onSend,
}: {
  leadId: string;
  onSend: (body: string, audioUrl: string | null) => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [sendingAudio, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const send = async (fd: FormData) => {
    const body = String(fd.get("body") ?? "").trim();
    const audio = fd.get("audio");
    const hasAudio = audio instanceof File && audio.size > 0;
    if (!body && !hasAudio) return;
    onSend(body, hasAudio ? URL.createObjectURL(audio) : null);
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
  };

  // La nota de voz se manda apenas se termina de grabar, junto con el texto que haya escrito.
  const recorder = useVoiceRecorder((file) => {
    const fd = formRef.current ? new FormData(formRef.current) : new FormData();
    fd.set("audio", file);
    startTransition(() => send(fd));
  });

  return (
    <form ref={formRef} action={send} className="space-y-2 rounded-xl border border-dashed border-brand-300 bg-brand-50/60 p-3">
      <label htmlFor="as-contact" className="flex items-center gap-1.5 text-xs font-semibold text-brand-800">
        <FlaskConical aria-hidden className="size-3.5" />
        Simulador: escribe o graba una nota de voz como si fueras el cliente
      </label>
      <textarea
        id="as-contact"
        name="body"
        rows={2}
        placeholder="Hola, quiero información sobre…"
        onKeyDown={submitOnEnter}
        className={inputClass}
      />
      {recorder.recording ? (
        <RecordingBar recorder={recorder} />
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <span className="mr-auto">
            <MicButton recorder={recorder} disabled={sendingAudio} label="Grabar nota de voz como cliente" />
          </span>
          <ContactSubmit busy={sendingAudio} />
        </div>
      )}
      {(error ?? recorder.error) && <FormMessage>{error ?? recorder.error}</FormMessage>}
    </form>
  );
}

function UserComposer({
  leadId,
  onSend,
}: {
  leadId: string;
  onSend: (body: string, audioUrl: string | null) => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [sendingAudio, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const send = async (fd: FormData) => {
    const body = String(fd.get("body") ?? "").trim();
    const audio = fd.get("audio");
    const hasAudio = audio instanceof File && audio.size > 0;
    if (!body && !hasAudio) return;
    onSend(body, hasAudio ? URL.createObjectURL(audio) : null);
    if (!hasAudio) formRef.current?.reset();
    setError(null);
    try {
      setError(await sendAsUserAction(leadId, fd));
    } catch (err) {
      console.error(err);
      router.refresh();
      setError("No se pudo enviar. Revisa tu conexión e intenta de nuevo.");
    }
  };

  // Como en WhatsApp, la nota de voz se manda sola apenas se termina de grabar.
  const recorder = useVoiceRecorder((file) => {
    const fd = new FormData();
    fd.set("audio", file);
    startTransition(() => send(fd));
  });

  return (
    <div className="space-y-2">
      <form ref={formRef} action={send} className="flex gap-2">
        {recorder.recording ? (
          <RecordingBar recorder={recorder} />
        ) : (
          <>
            <label htmlFor="reply" className="sr-only">
              Responder como ejecutivo
            </label>
            <input id="reply" name="body" required placeholder="Responder como ejecutivo (pausa la IA)" className={inputClass} />
            <MicButton recorder={recorder} disabled={sendingAudio} label="Grabar nota de voz" />
            <SubmitButton pendingText="Enviando…">
              <Send aria-hidden />
              <span className="hidden sm:inline">Enviar</span>
            </SubmitButton>
          </>
        )}
      </form>
      {(error ?? recorder.error) && <FormMessage>{error ?? recorder.error}</FormMessage>}
    </div>
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

/** Pide el seguimiento ahora, sin esperar el plazo. */
export function FollowUpNowButton({ leadId }: { leadId: string }) {
  const [message, action] = useActionState(sendFollowUpNowAction.bind(null, leadId), null);
  return (
    <form action={action} className="min-w-0 flex-1 space-y-2">
      <SubmitButton variant="secondary" className="w-full" pendingText="Escribiendo…">
        <BellRing aria-hidden />
        Enviar ahora
      </SubmitButton>
      {message && <FormMessage>{message}</FormMessage>}
    </form>
  );
}

/** Bloquear al contacto pide confirmación y un motivo opcional (ej. spam, postulante). */
export function BlockContactForm({ leadId }: { leadId: string }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button variant="ghost-danger" type="button" className="w-full" onClick={() => setOpen(true)}>
        <Ban aria-hidden />
        Bloquear contacto
      </Button>
    );
  }
  return (
    <form action={blockContactAction.bind(null, leadId)} className="space-y-2">
      <p className="text-xs text-slate-600">
        Sus leads abiertos se cierran como perdidos y sus mensajes nuevos se descartan: ni la IA ni el equipo le responden.
      </p>
      <label htmlFor="block-reason" className="sr-only">
        Motivo del bloqueo
      </label>
      <input id="block-reason" name="reason" placeholder="Motivo (opcional), ej. spam" className={inputClass} />
      <div className="flex gap-2">
        <SubmitButton variant="danger" pendingText="Bloqueando…">
          <Ban aria-hidden />
          Bloquear
        </SubmitButton>
        <Button variant="ghost" type="button" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
