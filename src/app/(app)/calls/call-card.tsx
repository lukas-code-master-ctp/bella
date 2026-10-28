"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Check, Loader2, Phone, RotateCw, X } from "lucide-react";
import { Button } from "@/components/ui";
import { toast } from "@/components/toast";
import { proposedTaskAction, retryCallAnalysisAction } from "./actions";

/** Llamada grabada, como la ve el chat: grabación, resumen, transcripción y tareas propuestas. */
export type ChatCall = {
  id: string;
  recordingUrl: string;
  /** PROCESSING, DONE o FAILED. */
  status: string | null;
  error: string | null;
  summary: string | null;
  nextStep: string | null;
  transcript: string | null;
  tasks: { title: string; due: string; created: boolean; dismissed: boolean }[];
};

/** Tarjeta bajo la nota "Llamada de WhatsApp" cuando la llamada quedó grabada. */
export function CallCard({ call }: { call: ChatCall }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<number | null>(null);

  const run = (index: number | null, action: () => Promise<string | null>, ok?: string) => {
    setBusy(index);
    start(async () => {
      const error = await action();
      setBusy(null);
      if (error) return toast(error, "error");
      if (ok) toast(ok);
      router.refresh();
    });
  };

  const open = call.tasks.map((t, i) => ({ ...t, index: i })).filter((t) => !t.dismissed);
  return (
    <div className="flex justify-center">
      <div className="w-full max-w-md space-y-3 rounded-2xl border border-slate-200 bg-white p-3 text-sm shadow-xs">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
          <Phone aria-hidden className="size-3.5" />
          Grabación de la llamada
        </p>
        <audio controls preload="none" src={call.recordingUrl} className="h-10 w-full" />

        {call.status === "PROCESSING" && (
          <p className="flex items-center gap-1.5 text-xs text-slate-600">
            <Loader2 aria-hidden className="size-3.5 animate-spin" />
            Transcribiendo y resumiendo…
          </p>
        )}

        {call.status === "FAILED" && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">
            <span>No se pudo resumir: {call.error ?? "error desconocido"}</span>
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(null, () => retryCallAnalysisAction(call.id))}>
              <RotateCw aria-hidden />
              Reintentar
            </Button>
          </div>
        )}

        {call.summary && (
          <div className="space-y-1.5">
            <p className="text-slate-800">{call.summary}</p>
            {call.nextStep && (
              <p className="text-slate-700">
                <span className="font-medium">Próximo paso:</span> {call.nextStep}
              </p>
            )}
          </div>
        )}

        {open.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-slate-700">Tareas que propone la IA</p>
            <ul className="space-y-1.5">
              {open.map((t) => (
                <li key={t.index} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-800" title={t.title}>
                      {t.title}
                    </p>
                    <p className="text-xs text-slate-600">vence {t.due}</p>
                  </div>
                  {t.created ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                      <Check aria-hidden className="size-3.5" />
                      Creada
                    </span>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={pending}
                        onClick={() => run(t.index, () => proposedTaskAction(call.id, t.index, true), "Tarea creada")}
                      >
                        {busy === t.index ? <Loader2 aria-hidden className="animate-spin" /> : <CalendarPlus aria-hidden />}
                        Crear
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        disabled={pending}
                        aria-label={`Descartar "${t.title}"`}
                        onClick={() => run(t.index, () => proposedTaskAction(call.id, t.index, false))}
                      >
                        <X aria-hidden />
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {call.transcript && (
          <details className="text-xs text-slate-700">
            <summary className="cursor-pointer font-medium text-slate-700">Ver transcripción</summary>
            <p className="mt-2 max-h-72 overflow-y-auto whitespace-pre-line rounded-lg bg-slate-50 p-2.5 leading-relaxed">{call.transcript}</p>
          </details>
        )}
      </div>
    </div>
  );
}
