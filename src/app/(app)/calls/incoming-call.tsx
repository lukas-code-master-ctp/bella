"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { uploadPresigned } from "@vercel/blob/client";
import { Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import type { RingingCall } from "@/lib/domain/calls";
import { Avatar, Button } from "@/components/ui";
import { toast } from "@/components/toast";
import {
  answerCallAction,
  hangUpCallAction,
  myCallsAction,
  rejectCallAction,
  saveCallRecordingAction,
  startCallAction,
} from "./actions";

/** Cada cuánto se pregunta por llamadas con la pestaña a la vista; el push avisa antes si llega. */
const POLL_MS = 4000;

/** `outgoing`: la hizo esta persona; `answered` marca que ya se puso la respuesta de audio del cliente. */
type Active = {
  call: RingingCall;
  pc: RTCPeerConnection;
  stream: MediaStream;
  since: number | null;
  outgoing?: boolean;
  answered?: boolean;
  /** Solo si la empresa graba llamadas. */
  recorder?: Recorder | null;
};

type Recorder = { addRemote(stream: MediaStream): void; start(): void; stop(): Promise<Blob | null> };

/**
 * Graba la llamada en el navegador: mezcla el micrófono y la voz del cliente en una sola pista
 * (Opus a 32 kbps, ~15 MB por hora). Null si el navegador no sabe grabar.
 */
function createRecorder(mic: MediaStream): Recorder | null {
  if (typeof MediaRecorder === "undefined") return null;
  let ctx: AudioContext;
  try {
    ctx = new AudioContext();
  } catch {
    return null;
  }
  const mix = ctx.createMediaStreamDestination();
  ctx.createMediaStreamSource(mic).connect(mix);
  const mimeType = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
  let rec: MediaRecorder;
  try {
    rec = new MediaRecorder(mix.stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32_000 });
  } catch {
    ctx.close().catch(() => {});
    return null;
  }
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  let remote = false;
  return {
    addRemote(stream) {
      if (remote) return;
      remote = true;
      ctx.createMediaStreamSource(stream).connect(mix);
    },
    start() {
      if (rec.state !== "inactive") return;
      ctx.resume().catch(() => {});
      rec.start(5000);
    },
    stop() {
      return new Promise((resolve) => {
        const close = () => ctx.close().catch(() => {});
        if (rec.state === "inactive") {
          close();
          return resolve(null);
        }
        rec.onstop = () => {
          close();
          resolve(chunks.length ? new Blob(chunks, { type: rec.mimeType || mimeType || "audio/webm" }) : null);
        };
        rec.stop();
      });
    },
  };
}

const extension = (type: string) => (type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm");

/** Sube la grabación directo a Vercel Blob y avisa a Beliapp para que la transcriba y resuma. */
async function saveRecording(callId: string, recorder: Recorder) {
  const blob = await recorder.stop();
  if (!blob) return;
  try {
    const type = blob.type.split(";")[0] || "audio/webm";
    const uploaded = await uploadPresigned(`calls/${callId}/llamada.${extension(type)}`, blob, {
      access: "public",
      handleUploadUrl: `/calls/${callId}/upload`,
      contentType: type,
    });
    const error = await saveCallRecordingAction(callId, uploaded.url);
    if (error) toast(error, "error");
  } catch (err) {
    console.error(err);
    toast("No se pudo guardar la grabación de la llamada.", "error");
  }
}

/** Evento para llamar a un lead desde cualquier parte de la app (el botón del chat). */
export const START_CALL_EVENT = "beliapp:call";
export type StartCallDetail = { leadId: string; name: string; phone: string | null };

const TERMINAL = ["ENDED", "MISSED", "REJECTED", "FAILED"];

/** Espera a que el navegador junte sus candidatos de red: Meta pide la respuesta completa, de una vez. */
function iceGathered(pc: RTCPeerConnection, timeoutMs = 3000) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    };
    const check = () => pc.iceGatheringState === "complete" && done();
    pc.addEventListener("icegatheringstatechange", check);
    setTimeout(done, timeoutMs);
  });
}

/** Timbre hecho con Web Audio (dos tonos cada 2 s), sin archivos. El navegador puede bloquearlo. */
function startRingtone() {
  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioContext();
  } catch {
    return () => {};
  }
  const ring = () => {
    if (!ctx || ctx.state === "closed") return;
    for (const [freq, at] of [
      [440, 0],
      [480, 0],
      [440, 0.5],
      [480, 0.5],
    ] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.value = 0.05;
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.4);
    }
  };
  ctx.resume().catch(() => {});
  ring();
  const timer = setInterval(ring, 2000);
  return () => {
    clearInterval(timer);
    ctx?.close().catch(() => {});
  };
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * Llamadas de WhatsApp en el navegador: muestra la que está sonando (a esta persona), la contesta
 * con el micrófono por WebRTC y deja los controles mientras dura. Va una vez en el layout.
 */
export function IncomingCall({ record = false }: { record?: boolean }) {
  const [ringing, setRinging] = useState<RingingCall[]>([]);
  const [active, setActive] = useState<Active | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [muted, setMuted] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const audio = useRef<HTMLAudioElement>(null);
  const activeRef = useRef<Active | null>(null);
  activeRef.current = active;

  const finish = useCallback((message?: string) => {
    const a = activeRef.current;
    if (a) {
      // Solo se guarda si la llamada alcanzó a conectarse; si no, la grabación se descarta.
      if (a.recorder) {
        if (a.since) saveRecording(a.call.id, a.recorder);
        else a.recorder.stop();
      }
      a.pc.close();
      a.stream.getTracks().forEach((t) => t.stop());
    }
    activeRef.current = null;
    setActive(null);
    setMuted(false);
    if (message) toast(message);
  }, []);

  const poll = useCallback(async () => {
    try {
      const res = await myCallsAction(activeRef.current?.call.id ?? null);
      setRinging(res.ringing);
      const a = activeRef.current;
      if (!a || !res.currentStatus) return;
      if (a.since) {
        if (res.currentStatus !== "ANSWERED") finish("La llamada terminó.");
      } else if (a.outgoing) {
        if (res.currentAnswer && !a.answered) {
          a.answered = true;
          await a.pc.setRemoteDescription({ type: "answer", sdp: res.currentAnswer });
        }
        if (res.currentStatus === "ANSWERED") {
          a.recorder?.start();
          const next = { ...a, since: Date.now() };
          activeRef.current = next;
          setActive(next);
          setNow(Date.now());
        } else if (TERMINAL.includes(res.currentStatus)) {
          finish(res.currentStatus === "REJECTED" ? "El cliente rechazó la llamada." : "El cliente no contestó.");
        }
      }
    } catch {
      // Sin red por un momento: se reintenta en la próxima vuelta.
    }
  }, [finish]);

  useEffect(() => {
    poll();
    const timer = setInterval(() => document.visibilityState === "visible" && poll(), POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && poll();
    // El service worker avisa a las pestañas cuando llega un push (ver public/sw.js).
    const onPush = () => poll();
    document.addEventListener("visibilitychange", onVisible);
    navigator.serviceWorker?.addEventListener("message", onPush);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      navigator.serviceWorker?.removeEventListener("message", onPush);
    };
  }, [poll]);

  // Mientras suena una llamada saliente se pregunta más seguido, para conectar el audio apenas contesten.
  const dialing = Boolean(active?.outgoing && !active.since);
  useEffect(() => {
    if (!dialing) return;
    const timer = setInterval(poll, 1000);
    return () => clearInterval(timer);
  }, [dialing, poll]);

  const call = active ? null : ringing.find((c) => !dismissed.has(c.id));

  useEffect(() => {
    if (!call) return;
    return startRingtone();
  }, [call?.id]);

  useEffect(() => {
    if (!active?.since) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active?.since]);

  // Cerrar la pestaña en plena llamada la corta en WhatsApp también.
  useEffect(() => {
    const onUnload = () => activeRef.current && hangUpCallAction(activeRef.current.call.id);
    window.addEventListener("pagehide", onUnload);
    return () => window.removeEventListener("pagehide", onUnload);
  }, []);

  /** Micrófono y conexión de audio; null si el navegador no dio permiso para el micrófono. */
  async function openAudio() {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast("Beliapp necesita permiso para usar el micrófono. Actívalo en el candado de la barra de direcciones.", "error");
      return null;
    }
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    for (const track of stream.getTracks()) pc.addTrack(track, stream);
    const recorder = record ? createRecorder(stream) : null;
    pc.ontrack = (e) => {
      const remote = e.streams[0] ?? new MediaStream([e.track]);
      recorder?.addRemote(remote);
      if (audio.current) {
        audio.current.srcObject = remote;
        audio.current.play().catch(() => {});
      }
    };
    pc.onconnectionstatechange = () => {
      const a = activeRef.current;
      if (["failed", "closed"].includes(pc.connectionState) && a?.pc === pc) {
        hangUpCallAction(a.call.id);
        finish("Se cortó la llamada.");
      }
    };
    return { stream, pc, recorder };
  }

  async function dial(d: StartCallDetail) {
    if (activeRef.current) return toast("Ya estás en una llamada.", "error");
    setConnecting(true);
    const media = await openAudio();
    if (!media) return setConnecting(false);
    const { stream, pc, recorder } = media;
    try {
      await pc.setLocalDescription(await pc.createOffer());
      await iceGathered(pc);
      const res = await startCallAction(d.leadId, pc.localDescription?.sdp ?? "");
      if ("error" in res) {
        recorder?.stop();
        pc.close();
        stream.getTracks().forEach((t) => t.stop());
        toast(res.error, "error");
        return;
      }
      const next: Active = {
        call: { id: res.callId, leadId: d.leadId, name: d.name, phone: d.phone, sdpOffer: "", createdAt: "" },
        pc,
        stream,
        since: null,
        outgoing: true,
        recorder,
      };
      activeRef.current = next;
      setActive(next);
    } catch {
      recorder?.stop();
      pc.close();
      stream.getTracks().forEach((t) => t.stop());
      toast("No se pudo iniciar la llamada.", "error");
    } finally {
      setConnecting(false);
    }
  }

  const dialRef = useRef(dial);
  dialRef.current = dial;
  useEffect(() => {
    const onStart = (e: Event) => dialRef.current((e as CustomEvent<StartCallDetail>).detail);
    window.addEventListener(START_CALL_EVENT, onStart);
    return () => window.removeEventListener(START_CALL_EVENT, onStart);
  }, []);

  async function answer(c: RingingCall) {
    setConnecting(true);
    const media = await openAudio();
    if (!media) return setConnecting(false);
    const { stream, pc, recorder } = media;
    try {
      await pc.setRemoteDescription({ type: "offer", sdp: c.sdpOffer });
      await pc.setLocalDescription(await pc.createAnswer());
      await iceGathered(pc);
      const next: Active = { call: c, pc, stream, since: null, recorder };
      setActive(next);
      activeRef.current = next;
      const error = await answerCallAction(c.id, pc.localDescription?.sdp ?? "");
      if (error) {
        finish();
        toast(error, "error");
      } else {
        recorder?.start();
        const connected = { ...next, since: Date.now() };
        activeRef.current = connected;
        setActive(connected);
        setNow(Date.now());
      }
    } catch {
      recorder?.stop();
      pc.close();
      stream.getTracks().forEach((t) => t.stop());
      setActive(null);
      toast("No se pudo conectar el audio de la llamada.", "error");
    } finally {
      setConnecting(false);
      setRinging((r) => r.filter((x) => x.id !== c.id));
    }
  }

  async function reject(c: RingingCall) {
    setDismissed((d) => new Set(d).add(c.id));
    await rejectCallAction(c.id);
  }

  function toggleMute() {
    const a = activeRef.current;
    if (!a) return;
    a.stream.getAudioTracks().forEach((t) => (t.enabled = muted));
    setMuted(!muted);
  }

  async function hangUp() {
    const a = activeRef.current;
    if (!a) return;
    finish();
    await hangUpCallAction(a.call.id);
  }

  const shown = active?.call ?? call;
  return (
    <>
      <audio ref={audio} autoPlay className="hidden" />
      {shown && (
        <div
          role="dialog"
          aria-live="assertive"
          aria-label={active ? `En llamada con ${shown.name}` : `Llamada de WhatsApp de ${shown.name}`}
          className="animate-pop fixed inset-x-4 bottom-24 z-50 rounded-2xl border border-slate-200 bg-white p-4 shadow-xl sm:left-auto sm:right-6 sm:w-80 lg:bottom-6"
        >
          <div className="flex items-center gap-3">
            <span className={`rounded-full ${active ? "" : "animate-pulse"}`}>
              <Avatar name={shown.name} />
            </span>
            <div className="min-w-0 flex-1">
              <Link href={`/leads/${shown.leadId}`} className="block truncate text-sm font-semibold text-slate-900 hover:underline">
                {shown.name}
              </Link>
              <p className="truncate text-xs text-slate-600">
                {active
                  ? active.since
                    ? `En llamada · ${clock(Math.max(0, Math.round((now - active.since) / 1000)))}${active.recorder ? " · grabando" : ""}`
                    : active.outgoing
                      ? "Llamando por WhatsApp…"
                      : "Conectando…"
                  : `Llamada de WhatsApp${shown.phone ? ` · ${shown.phone}` : ""}`}
              </p>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            {active ? (
              <>
                <Button variant="secondary" className="flex-1" onClick={toggleMute} aria-pressed={muted}>
                  {muted ? <MicOff aria-hidden /> : <Mic aria-hidden />}
                  {muted ? "Activar micrófono" : "Silenciar"}
                </Button>
                <Button variant="danger" className="flex-1" onClick={hangUp}>
                  <PhoneOff aria-hidden />
                  Cortar
                </Button>
              </>
            ) : (
              <>
                <Button variant="danger" className="flex-1" onClick={() => reject(shown)} disabled={connecting}>
                  <PhoneOff aria-hidden />
                  Rechazar
                </Button>
                <Button variant="success" className="flex-1" onClick={() => answer(shown)} disabled={connecting}>
                  <Phone aria-hidden />
                  {connecting ? "Conectando…" : "Contestar"}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
