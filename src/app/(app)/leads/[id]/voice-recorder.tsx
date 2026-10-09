"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import { encodeWav, mergeAndResample, peakLevel } from "@/lib/wav";

/**
 * Una nota de voz pesa ~32 KB por segundo (WAV de 16 kHz) y el servidor acepta hasta 4 MB
 * (AUDIO_MAX_BYTES en src/lib/media.ts): a esta duración se corta sola y se envía.
 */
const MAX_SECONDS = 120;

/** Bajo este volumen máximo la grabación se considera silencio (micrófono apagado o equivocado). */
const SILENCE_PEAK = 0.01;

type Recording = {
  stream: MediaStream;
  context: AudioContext;
  processor: ScriptProcessorNode;
  chunks: Float32Array[];
  startedAt: number;
};

/**
 * Graba una nota de voz con el micrófono, como en WhatsApp: `start` pide permiso y empieza,
 * `finish` entrega el archivo y `cancel` lo descarta. Se toma el audio crudo y se arma un WAV
 * (ver src/lib/wav.ts), así no dependemos del codificador de cada navegador.
 */
export function useVoiceRecorder(onRecorded: (file: File) => void) {
  const [supported, setSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<Recording | null>(null);
  const levelRef = useRef(0);
  const onRecordedRef = useRef(onRecorded);
  onRecordedRef.current = onRecorded;

  // Se revisa en el cliente para no desalinear el HTML del servidor al hidratar.
  useEffect(() => {
    setSupported(typeof AudioContext !== "undefined" && !!navigator.mediaDevices?.getUserMedia);
  }, []);

  const stop = useCallback((keep: boolean) => {
    const rec = current.current;
    if (!rec) return;
    current.current = null;
    setRecording(false);
    rec.processor.onaudioprocess = null;
    rec.processor.disconnect();
    rec.stream.getTracks().forEach((t) => t.stop());
    void rec.context.close();
    if (!keep) return;
    const samples = mergeAndResample(rec.chunks, rec.context.sampleRate);
    if (!samples.length) return setError("No se grabó nada. Revisa el micrófono e intenta de nuevo.");
    if (peakLevel(samples) < SILENCE_PEAK) {
      return setError("La grabación quedó en silencio: revisa que el micrófono correcto esté activo y no silenciado.");
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
    const wav = encodeWav(samples);
    onRecordedRef.current(new File([wav], `nota-de-voz-${stamp}.wav`, { type: "audio/wav" }));
  }, []);

  const start = useCallback(async () => {
    if (current.current) return;
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      const denied = err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError");
      setError(
        denied
          ? "El navegador no tiene permiso para usar el micrófono. Actívalo en el candado junto a la dirección."
          : "No se encontró un micrófono disponible.",
      );
      return;
    }
    const context = new AudioContext();
    await context.resume();
    const source = context.createMediaStreamSource(stream);
    // ScriptProcessor entrega el audio crudo en todos los navegadores, sin archivos aparte.
    const processor = context.createScriptProcessor(4096, 1, 1);
    const mute = context.createGain();
    mute.gain.value = 0;
    const rec: Recording = { stream, context, processor, chunks: [], startedAt: Date.now() };
    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      rec.chunks.push(new Float32Array(input));
      levelRef.current = Math.max(levelRef.current, peakLevel(input));
    };
    source.connect(processor);
    processor.connect(mute);
    mute.connect(context.destination);
    current.current = rec;
    setSeconds(0);
    setLevel(0);
    setHeard(false);
    setRecording(true);
  }, []);

  // Cronómetro, medidor de volumen y corte automático al llegar al máximo.
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => {
      const rec = current.current;
      if (!rec) return;
      const elapsed = Math.floor((Date.now() - rec.startedAt) / 1000);
      setSeconds(elapsed);
      setLevel(levelRef.current);
      if (levelRef.current >= SILENCE_PEAK) setHeard(true);
      levelRef.current = 0;
      if (elapsed >= MAX_SECONDS) stop(true);
    }, 100);
    return () => clearInterval(timer);
  }, [recording, stop]);

  // Si se sale de la página grabando, se suelta el micrófono.
  useEffect(() => () => stop(false), [stop]);

  return {
    supported,
    recording,
    seconds,
    level,
    heard,
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
  // Si tras un par de segundos no ha llegado ningún sonido, se avisa antes de enviar una nota vacía.
  const quiet = recorder.seconds >= 2 && !recorder.heard;
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
        <span className="truncate">{quiet ? "No se escucha el micrófono…" : "Grabando nota de voz…"}</span>
        <LevelMeter level={recorder.level} />
      </div>
      <Button type="button" size="icon" onClick={recorder.finish} aria-label="Enviar nota de voz" title="Enviar">
        <Send aria-hidden />
      </Button>
    </div>
  );
}

/** Barras que se mueven con la voz, para saber que el micrófono está captando. */
function LevelMeter({ level }: { level: number }) {
  // La raíz hace visible también la voz baja.
  const filled = Math.round(Math.sqrt(Math.min(1, level)) * 5);
  return (
    <span aria-hidden className="ml-auto flex h-4 shrink-0 items-end gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`w-1 rounded-full transition-colors duration-100 ${i <= filled ? "bg-rose-600" : "bg-rose-200"}`}
          style={{ height: `${i * 20}%` }}
        />
      ))}
    </span>
  );
}
