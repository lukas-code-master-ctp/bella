"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import type { RingingCall } from "@/lib/domain/calls";
import { Avatar, Button } from "@/components/ui";
import { toast } from "@/components/toast";
import { answerCallAction, hangUpCallAction, myCallsAction, rejectCallAction } from "./actions";

/** Cada cuánto se pregunta por llamadas con la pestaña a la vista; el push avisa antes si llega. */
const POLL_MS = 4000;

type Active = { call: RingingCall; pc: RTCPeerConnection; stream: MediaStream; since: number | null };

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
export function IncomingCall() {
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
      a.pc.close();
      a.stream.getTracks().forEach((t) => t.stop());
    }
    setActive(null);
    setMuted(false);
    if (message) toast(message);
  }, []);

  const poll = useCallback(async () => {
    try {
      const res = await myCallsAction(activeRef.current?.call.id ?? null);
      setRinging(res.ringing);
      const a = activeRef.current;
      if (a && a.since && res.currentStatus && res.currentStatus !== "ANSWERED") finish("La llamada terminó.");
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

  async function answer(c: RingingCall) {
    setConnecting(true);
    let stream: MediaStream | null = null;
    let pc: RTCPeerConnection | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setConnecting(false);
      toast("Beliapp necesita permiso para usar el micrófono. Actívalo en el candado de la barra de direcciones.", "error");
      return;
    }
    try {
      pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      for (const track of stream.getTracks()) pc.addTrack(track, stream);
      pc.ontrack = (e) => {
        if (audio.current) {
          audio.current.srcObject = e.streams[0] ?? new MediaStream([e.track]);
          audio.current.play().catch(() => {});
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc && ["failed", "closed"].includes(pc.connectionState) && activeRef.current?.pc === pc) {
          hangUpCallAction(c.id);
          finish("Se cortó la llamada.");
        }
      };
      await pc.setRemoteDescription({ type: "offer", sdp: c.sdpOffer });
      await pc.setLocalDescription(await pc.createAnswer());
      await iceGathered(pc);
      const next: Active = { call: c, pc, stream, since: null };
      setActive(next);
      activeRef.current = next;
      const error = await answerCallAction(c.id, pc.localDescription?.sdp ?? "");
      if (error) {
        finish();
        toast(error, "error");
      } else {
        setActive({ ...next, since: Date.now() });
        setNow(Date.now());
      }
    } catch {
      pc?.close();
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
                    ? `En llamada · ${clock(Math.max(0, Math.round((now - active.since) / 1000)))}`
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
