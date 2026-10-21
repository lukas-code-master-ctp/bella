"use client";

import { useActionState, useCallback, useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Activity, Ban, BellRing, Bot, Check, CheckCheck, CircleAlert, Clock, Download, ExternalLink, FileText, Flag, FlaskConical, MessageCircle, Mic, PencilLine, Play, RefreshCw, Send, Target } from "lucide-react";
import { Button, EmptyState, FormMessage, TypingDots, inputClass } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { refreshInsightsAction, sendAsContactAction, sendAsUserAction, sendFollowUpNowAction } from "./actions";
import { ActivityPanel } from "./activity-panel";
import { CorrectionDialog } from "./correction-dialog";
import { timeline } from "@/lib/chat-timeline";
import { MicButton, RecordingBar, useVoiceRecorder } from "./voice-recorder";
import { autoGrow, useQuickReplyMenu, type QuickReplyOption } from "./quick-replies";

export type ChatMessage = {
  id: string;
  author: "CONTACT" | "AI" | "USER";
  authorName: string;
  body: string;
  /** Nota de voz: archivo y transcripción (null si no se pudo transcribir). */
  audio?: { url: string; transcript: string | null };
  /** Imagen, video o documento (enviado por la IA o por el cliente). */
  file?: { url: string; name: string; kind: "image" | "video" | "document" | "audio" };
  /** Hora ya formateada en el servidor (evita diferencias de zona horaria al hidratar). */
  time: string;
  /** Momento del mensaje (ms), para intercalarlo con los eventos del lead. */
  at?: number;
  pending?: boolean;
  /** Entrega por WhatsApp de un mensaje enviado (no existe en el simulador). */
  delivery?: { status: string; error: string | null };
};

/** Algo que le pasó al lead (cambio de etapa, asignación, IA pausada…), intercalado en la conversación. */
export type ChatEvent = {
  id: string;
  /** Momento del evento (ms). */
  at: number;
  /** Texto ya armado en el servidor, p. ej. "Cambio de etapa: Nuevo → Calificado". */
  text: string;
  /** Quién lo hizo: nombre del ejecutivo, "IA" o "Sistema". */
  actor: string;
  reason: string | null;
  time: string;
  tone: "neutral" | "success" | "danger";
};

/** Anuncio de Meta por el que el cliente escribió; se muestra arriba del primer mensaje. */
export type ChatAd = {
  /** "Anuncio de Meta" o "Publicación de Meta". */
  label: string;
  campaign: string | null;
  headline: string | null;
  body: string | null;
  imageUrl: string | null;
  video: boolean;
  url: string | null;
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
  events = [],
  ad = null,
  contactName,
  userName,
  simulator,
  blocked = false,
  isAdmin = false,
  quickReplies = [],
}: {
  leadId: string;
  messages: ChatMessage[];
  events?: ChatEvent[];
  ad?: ChatAd | null;
  contactName: string;
  userName: string;
  simulator: boolean;
  /** Contacto bloqueado: no se le escribe ni se simula que escribe. */
  blocked?: boolean;
  isAdmin?: boolean;
  /** Respuestas rápidas del usuario, que busca escribiendo "/". */
  quickReplies?: QuickReplyOption[];
}) {
  const [shown, addPending] = useOptimistic(messages, (list, m: ChatMessage) => [...list, m]);
  const [inspected, setInspected] = useState<ChatMessage | null>(null);
  const [correcting, setCorrecting] = useState<ChatMessage | null>(null);
  const closeCorrection = useCallback(() => setCorrecting(null), []);
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
        {ad && shown.length > 0 && <AdCard ad={ad} />}
        {timeline(shown, events).map((item) =>
          "text" in item ? (
            <EventNote key={item.id} event={item} />
          ) : (
            <Bubble
              key={item.id}
              message={item}
              animate={entersAnimated(item)}
              onInspect={item.author === "AI" && !item.pending ? () => setInspected(item) : undefined}
              onCorrect={item.author === "AI" && !item.pending && item.body ? () => setCorrecting(item) : undefined}
            />
          ),
        )}
        {typing && <TypingBubble />}
        <ScrollToBottom dep={shown.length + events.length + (typing ? 1 : 0)} />
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
          quickReplies={quickReplies}
          onSend={(body, audioUrl) => {
            if (audioUrl) addPending(pending("USER", "", { url: audioUrl, transcript: null }));
            if (body) addPending(pending("USER", body));
          }}
        />
      </div>
      )}

      <ActivityPanel leadId={leadId} message={inspected} onClose={closeInspector} />
      <CorrectionDialog leadId={leadId} message={correcting} isAdmin={isAdmin} onClose={closeCorrection} />
    </>
  );
}

const EVENT_TONE: Record<ChatEvent["tone"], string> = {
  neutral: "border-slate-200 bg-white text-slate-600",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  danger: "border-rose-200 bg-rose-50 text-rose-800",
};

/** Nota discreta al centro del chat con un evento del lead; el motivo queda en el tooltip. */
function EventNote({ event }: { event: ChatEvent }) {
  return (
    <div className="flex justify-center py-0.5">
      <p
        title={event.reason ?? undefined}
        className={`inline-flex max-w-[92%] flex-wrap items-center justify-center gap-x-1.5 rounded-full border px-3 py-1 text-center text-[11px] leading-snug ${EVENT_TONE[event.tone]}`}
      >
        <Flag aria-hidden className="size-3 shrink-0 opacity-70" />
        <span className="font-medium">{event.text}</span>
        <span className="opacity-75">
          {[event.actor, event.time].filter(Boolean).join(" · ")}
        </span>
      </p>
    </div>
  );
}

/** Tarjeta del anuncio, como la ve el cliente en WhatsApp: imagen, título, texto y enlace. */
function AdCard({ ad }: { ad: ChatAd }) {
  const link = ad.url && /^https?:\/\//.test(ad.url) ? ad.url : null;
  return (
    <div className="flex flex-col items-start">
      <div className="w-72 max-w-[85%] overflow-hidden rounded-2xl border border-slate-200 bg-white text-sm shadow-xs sm:max-w-[70%]">
        {ad.imageUrl && (
          <div className="relative bg-slate-100">
            <img
              src={ad.imageUrl}
              alt=""
              loading="lazy"
              className="max-h-72 w-full object-cover"
              onError={(e) => (e.currentTarget.parentElement!.hidden = true)}
            />
            {ad.video && (
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="flex size-10 items-center justify-center rounded-full bg-black/55 text-white">
                  <Play aria-hidden className="size-5 translate-x-px fill-current" />
                </span>
              </span>
            )}
          </div>
        )}
        <div className="space-y-1 px-3.5 py-2.5">
          <p className="flex items-center gap-1 text-[11px] font-semibold text-brand-700">
            <Target aria-hidden className="size-3.5" />
            {ad.label}
            {ad.campaign && <span className="truncate font-normal text-slate-600">· {ad.campaign}</span>}
          </p>
          {ad.headline && <p className="font-semibold text-slate-900">{ad.headline}</p>}
          {ad.body && <p className="line-clamp-6 whitespace-pre-line text-slate-700" title={ad.body}>{ad.body}</p>}
          {link && (
            <a href={link} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
              <ExternalLink aria-hidden className="size-3.5" />
              Ver anuncio
            </a>
          )}
        </div>
      </div>
    </div>
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

/**
 * Burbuja del chat. Las de la IA se pueden abrir en el monitor de actividad y corregir (la
 * corrección se vuelve un aprendizaje que aprueba un admin).
 */
function Bubble({
  message: m,
  animate,
  onInspect,
  onCorrect,
}: {
  message: ChatMessage;
  animate?: boolean;
  onInspect?: () => void;
  onCorrect?: () => void;
}) {
  const fromContact = m.author === "CONTACT";
  const Wrapper = onInspect ? "button" : "div";
  return (
    <div
      className={`group flex flex-col ${fromContact ? "items-start" : "items-end"} ${
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
        {m.file && <Attachment file={m.file} light={fromContact} />}
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
      {onCorrect && (
        <button
          type="button"
          onClick={onCorrect}
          className="mt-0.5 inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-slate-500 transition-[opacity,color] hover:bg-slate-100 hover:text-slate-900 focus-visible:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
        >
          <PencilLine aria-hidden className="size-3.5" />
          Corregir
        </button>
      )}
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

/** Archivo del mensaje: la imagen (ampliable) o el video se ven en el chat; un documento, con su nombre y botón para descargarlo. */
function Attachment({ file, light }: { file: NonNullable<ChatMessage["file"]>; light: boolean }) {
  if (file.kind === "image") return <ImagePreview file={file} />;
  if (file.kind === "video") {
    return <video controls preload="metadata" src={file.url} className="mb-1 max-h-64 w-64 max-w-full rounded-lg bg-black" />;
  }
  const tone = light ? "bg-slate-50 text-slate-800 hover:bg-slate-100" : "bg-white/15 text-white hover:bg-white/25";
  return (
    <span className="mb-1 flex items-stretch gap-1">
      <a
        href={file.url}
        target="_blank"
        rel="noreferrer"
        title="Abrir"
        onClick={(e) => e.stopPropagation()}
        className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] font-medium ${tone}`}
      >
        <FileText aria-hidden className="size-4 shrink-0" />
        <span className="min-w-0 truncate">{file.name}</span>
      </a>
      <a
        href={downloadUrl(file.url)}
        title="Descargar"
        onClick={(e) => e.stopPropagation()}
        className={`flex shrink-0 items-center rounded-lg px-2 ${tone}`}
      >
        <Download aria-hidden className="size-4" />
        <span className="sr-only">Descargar {file.name}</span>
      </a>
    </span>
  );
}

/** Enlace de Vercel Blob que descarga el archivo en vez de abrirlo. */
const downloadUrl = (url: string) => `${url}${url.includes("?") ? "&" : "?"}download=1`;

/** Miniatura de una imagen; al tocarla se ve en grande, con opción de abrirla o descargarla. */
function ImagePreview({ file }: { file: NonNullable<ChatMessage["file"]> }) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      {/* span y no button: la burbuja de la IA ya es un botón (ver actividad). */}
      <span
        role="button"
        tabIndex={0}
        aria-label={`Ver en grande: ${file.name}`}
        onClick={(e) => {
          e.stopPropagation();
          ref.current?.showModal();
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          e.stopPropagation();
          ref.current?.showModal();
        }}
        className="mb-1 block cursor-zoom-in"
      >
        <img src={file.url} alt={file.name} loading="lazy" className="max-h-64 w-64 max-w-full rounded-lg bg-white/10 object-cover" />
      </span>
      <dialog
        ref={ref}
        onClick={(e) => {
          e.stopPropagation();
          if (e.target === e.currentTarget) ref.current?.close();
        }}
        aria-label={file.name}
        className="m-auto max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] bg-transparent p-0 backdrop:bg-slate-900/80 open:animate-pop"
      >
        <img src={file.url} alt={file.name} className="max-h-[calc(100dvh-6rem)] max-w-full rounded-lg object-contain" />
        <span className="mt-2 flex justify-center gap-2">
          <a href={downloadUrl(file.url)} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-[13px] font-medium text-slate-800 hover:bg-slate-100">
            <Download aria-hidden className="size-4" />
            Descargar
          </a>
          <span
            role="button"
            tabIndex={0}
            onClick={() => ref.current?.close()}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && ref.current?.close()}
            className="cursor-pointer rounded-lg bg-white px-3 py-1.5 text-[13px] font-medium text-slate-800 hover:bg-slate-100"
          >
            Cerrar
          </span>
        </span>
      </dialog>
    </>
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
  quickReplies,
  onSend,
}: {
  leadId: string;
  quickReplies: QuickReplyOption[];
  onSend: (body: string, audioUrl: string | null) => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [sendingAudio, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const quick = useQuickReplyMenu(quickReplies, replyRef);

  const send = async (fd: FormData) => {
    const body = String(fd.get("body") ?? "").trim();
    const audio = fd.get("audio");
    const hasAudio = audio instanceof File && audio.size > 0;
    if (!body && !hasAudio) return;
    onSend(body, hasAudio ? URL.createObjectURL(audio) : null);
    if (!hasAudio) {
      formRef.current?.reset();
      autoGrow(replyRef.current);
    }
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
      <form ref={formRef} action={send} className="relative flex items-end gap-2">
        {recorder.recording ? (
          <RecordingBar recorder={recorder} />
        ) : (
          <>
            <label htmlFor="reply" className="sr-only">
              Responder como ejecutivo
            </label>
            {quick.menu}
            <textarea
              ref={replyRef}
              id="reply"
              name="body"
              required
              rows={1}
              placeholder='Responder como ejecutivo (pausa la IA) · "/" respuestas rápidas'
              className={`${inputClass} max-h-40 resize-none`}
              {...quick.ariaProps}
              onInput={(e) => {
                autoGrow(e.currentTarget);
                quick.refresh();
              }}
              onSelect={quick.refresh}
              onBlur={quick.close}
              onKeyDown={(e) => {
                if (!quick.onKeyDown(e)) submitOnEnter(e);
              }}
            />
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
