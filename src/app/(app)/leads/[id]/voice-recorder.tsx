"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui";

/**
 * Formatos en orden de preferencia. La transcripción (OpenRouter) entiende ogg y m4a; webm queda
 * de último recurso para navegadores que no graban en otro formato.
 */
const MIME_TYPES = ["audio/ogg;codecs=opus", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus", "audio/webm"];

const EXTENSIONS: Record<string, string> = { "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/webm": "webm" };

/** Igual que AUDIO_MAX_BYTES en el servidor (src/lib/media.ts, que no se puede importar aquí). */
export const AUDIO_MAX_MB = 4;

/** Una nota de voz no debería pasar de unos minutos; a esta duración se corta sola. */
const MAX_SECONDS = 5 * 60;

type Recording = { recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; startedAt: number };

/**
 * Graba una nota de voz con el micrófono, como en WhatsApp: `start` pide permiso y empieza,
 * `finish` entrega el archivo y `cancel` lo descarta.
 */
export function useVoiceRecorder(onRecorded: (file: File) => void) {
  const [supported, setSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<Recording | null>(null);
  const onRecordedRef = useRef(onRecorded);
  onRecordedRef.current = onRecorded;

  // Se revisa en el cliente para no desalinear el HTML del servidor al hidratar.
  useEffect(() => {
    setSupported(typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia);
  }, []);

  const stop = useCallback((keep: boolean) => {
    const rec = current.current;
    if (!rec) return;
    current.current = null;
    setRecording(false);
    rec.recorder.onstop = () => {
      rec.stream.getTracks().forEach((t) => t.stop());
      if (!keep) return;
      const type = (rec.recorder.mimeType || rec.chunks[0]?.type || "audio/webm").split(";")[0];
      const blob = new Blob(rec.chunks, { type });
      if (!blob.size) return setError("No se grabó nada. Revisa el micrófono e intenta de nuevo.");
      if (blob.size > AUDIO_MAX_MB * 1024 * 1024) return setError(`La nota de voz pesa más de ${AUDIO_MAX_MB} MB.`);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
      onRecordedRef.current(new File([blob], `nota-de-voz-${stamp}.${EXTENSIONS[type] ?? "webm"}`, { type }));
    };
    if (rec.recorder.state === "inactive") rec.recorder.onstop(new Event("stop"));
    else rec.recorder.stop();
  }, []);

  const start = useCallback(async () => {
    if (current.current) return;
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (err) {
      const denied = err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError");
      setError(
        denied
          ? "El navegador no tiene permiso para usar el micrófono. Actívalo en el candado junto a la dirección."
          : "No se encontró un micrófono disponible.",
      );
      return;
    }
    const mimeType = MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32_000 });
    const rec: Recording = { recorder, stream, chunks: [], startedAt: Date.now() };
    recorder.ondataavailable = (e) => {
      if (e.data.size) rec.chunks.push(e.data);
    };
    current.current = rec;
    recorder.start(250);
    setSeconds(0);
    setRecording(true);
  }, []);

  // Cronómetro, y corte automático al llegar al máximo.
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => {
      const rec = current.current;
      if (!rec) return;
      const elapsed = Math.floor((Date.now() - rec.startedAt) / 1000);
      setSeconds(elapsed);
      if (elapsed >= MAX_SECONDS) stop(true);
    }, 250);
    return () => clearInterval(timer);
  }, [recording, stop]);

  // Si se sale de la página grabando, se suelta el micrófono.
  useEffect(() => () => stop(false), [stop]);

  return {
    supported,
    recording,
    seconds,
    error,
    clearError: () => setError(null),
    start,
    finish: () => stop(true),
    cancel: () => stop(false),
  };
}

export type VoiceRecorder = ReturnType<typeof useVoiceRecorder>;

/** Botón de micrófono para empezar a grabar. No aparece si el navegador no puede grabar. */
export function MicButton({ recorder, disabled, label }: { recorder: VoiceRecorder; disabled?: boolean; label: string }) {
  if (!recorder.supported) return null;
  return (
    <Button
      type="button"
      variant="secondary"
      size="icon"
      disabled={disabled}
      onClick={recorder.start}
      aria-label={label}
      title={label}
    >
      <Mic aria-hidden />
    </Button>
  );
}

/** Barra mientras se graba: descartar, cronómetro y enviar. */
export function RecordingBar({ recorder }: { recorder: VoiceRecorder }) {
  const m = Math.floor(recorder.seconds / 60);
  const s = String(recorder.seconds % 60).padStart(2, "0");
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <Button type="button" variant="ghost-danger" size="icon" onClick={recorder.cancel} aria-label="Descartar nota de voz" title="Descartar">
        <Trash2 aria-hidden />
      </Button>
      <div role="status" className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 text-sm text-rose-800">
        <span aria-hidden className="size-2.5 shrink-0 animate-pulse rounded-full bg-rose-600" />
        <span className="tabular-nums font-semibold">
          {m}:{s}
        </span>
        <span className="truncate">Grabando nota de voz…</span>
      </div>
      <Button type="button" size="icon" onClick={recorder.finish} aria-label="Enviar nota de voz" title="Enviar">
        <Send aria-hidden />
      </Button>
    </div>
  );
}
