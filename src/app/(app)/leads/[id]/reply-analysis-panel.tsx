"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CircleCheck, CircleHelp, FlaskConical, LoaderCircle, Pencil, Sparkles, TriangleAlert, Wrench } from "lucide-react";
import type { Citation, ReplyAnalysis, SourceKind } from "@/lib/domain/reply-analysis";
import type { FixProposal, FixTrial } from "@/lib/domain/reply-fix";
import { Badge, Button, FormMessage, inputClass } from "@/components/ui";
import { DiffView } from "@/components/diff-view";
import { toast } from "@/components/toast";
import { applyFixAction, explainReplyAction, proposeFixAction, tryFixAction } from "./actions";

const TONE: Partial<Record<SourceKind, "brand" | "warning" | "neutral">> = {
  instructions: "brand",
  funnel: "brand",
  variant: "brand",
  lesson: "brand",
  stage_rule: "brand",
  knowledge: "brand",
  files: "brand",
  block: "brand",
  unknown: "warning",
};

/**
 * Analizar una respuesta de la IA, arriba del monitor de actividad: por qué respondió así y, con lo
 * que se esperaba, el cambio en la configuración que lo corrige, probado antes de guardarlo.
 */
export function ReplyAnalysisPanel({ leadId, message, focusFix }: { leadId: string; message: { id: string; body: string }; focusFix?: boolean }) {
  return (
    <div className="mb-4 space-y-3">
      <ReplyExplanation leadId={leadId} messageId={message.id} />
      <ReplyFix leadId={leadId} message={message} autoFocus={focusFix} />
    </div>
  );
}

/**
 * "¿Por qué respondió esto?": la IA lee lo que se guardó del turno y explica la respuesta, citando
 * los fragmentos de la configuración que más pesaron, con un enlace para editarlos.
 */
function ReplyExplanation({ leadId, messageId }: { leadId: string; messageId: string }) {
  const [analysis, setAnalysis] = useState<ReplyAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const explain = () =>
    start(async () => {
      setError(null);
      const result = await explainReplyAction(leadId, messageId).catch(() => ({ error: "No se pudo analizar. Intenta de nuevo." }));
      if ("error" in result) setError(result.error);
      else setAnalysis(result.analysis);
    });

  return (
    <section aria-labelledby="explain-title" className="rounded-xl bg-brand-50/60 p-3.5 ring-1 ring-inset ring-brand-100">
      <h3 id="explain-title" className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <CircleHelp aria-hidden className="size-4 text-brand-600" />
        ¿Por qué respondió esto?
      </h3>

      {!analysis && (
        <>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-600">
            La IA revisa lo que tenía en este turno y te explica qué pesó en la respuesta y de qué parte de la configuración salió.
          </p>
          {error && <div className="mt-2"><FormMessage>{error}</FormMessage></div>}
          <div className="mt-3">
            {pending ? (
              <p role="status" className="flex items-center gap-2 text-sm text-slate-600">
                <LoaderCircle aria-hidden className="size-4 animate-spin" />
                Analizando la respuesta…
              </p>
            ) : (
              <Button size="sm" onClick={explain}>
                <Sparkles aria-hidden />
                Explicar
              </Button>
            )}
          </div>
        </>
      )}

      {analysis && (
        <div className="mt-2 space-y-3 animate-fade-in">
          <p className="text-sm leading-relaxed text-slate-800">{analysis.summary}</p>

          {analysis.citations.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold text-slate-700">Lo que más pesó</p>
              <ol className="space-y-2">
                {analysis.citations.map((c, i) => (
                  <CitationItem key={i} citation={c} />
                ))}
              </ol>
            </div>
          )}

          {analysis.missing.length > 0 && (
            <div className="rounded-lg bg-amber-50 p-2.5 ring-1 ring-inset ring-amber-200">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-amber-900">
                <TriangleAlert aria-hidden className="size-3.5 text-amber-600" />
                Lo que no sabía
              </p>
              <ul className="list-disc space-y-0.5 pl-5 text-[13px] leading-relaxed text-amber-900">
                {analysis.missing.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}

          {analysis.currentConfig && (
            <p className="text-xs text-slate-500">
              Este mensaje es anterior al registro de instrucciones: se analizó con la configuración de hoy.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function CitationItem({ citation: c }: { citation: Citation }) {
  return (
    <li className="rounded-lg bg-white p-2.5 ring-1 ring-inset ring-slate-200">
      <blockquote className="border-l-2 border-brand-300 pl-2.5 text-[13px] italic leading-relaxed text-slate-800">{c.quote}</blockquote>
      {c.why && <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600">{c.why}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Badge tone={TONE[c.source.kind] ?? "neutral"}>{c.source.label}</Badge>
        {c.source.href && (
          <Link
            href={c.source.href}
            className="inline-flex min-h-8 items-center gap-1 rounded-md px-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50"
          >
            <Pencil aria-hidden className="size-3.5" />
            Editar
          </Link>
        )}
      </div>
    </li>
  );
}

type Step = "idle" | "proposing" | "trying" | "applying";

/**
 * "¿Qué esperabas?": la IA propone el cambio donde corresponde (instrucciones, embudo, regla de
 * etapa o aprendizaje). Se puede editar, probar repitiendo el turno sin enviar nada, y aplicar.
 */
function ReplyFix({ leadId, message, autoFocus }: { leadId: string; message: { id: string; body: string }; autoFocus?: boolean }) {
  const [expected, setExpected] = useState("");
  const [proposal, setProposal] = useState<FixProposal | null>(null);
  const [trial, setTrial] = useState<FixTrial | null>(null);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [, start] = useTransition();

  const run = <T,>(next: Step, call: () => Promise<T | { error: string }>, done: (result: T) => void) =>
    start(async () => {
      setError(null);
      setStep(next);
      const result = await call().catch(() => ({ error: "No se pudo. Intenta de nuevo." }));
      setStep("idle");
      if (result && typeof result === "object" && "error" in result) setError(result.error);
      else done(result as T);
    });

  const propose = () =>
    run("proposing", () => proposeFixAction(leadId, message.id, expected), (r: { proposal: FixProposal }) => {
      setProposal(r.proposal);
      setTrial(null);
    });
  const edit = (patch: Partial<FixProposal>) => {
    setProposal((p) => (p ? { ...p, ...patch } : p));
    setTrial(null);
  };
  const tryIt = () => proposal && run("trying", () => tryFixAction(leadId, message.id, proposal), (r: { trial: FixTrial }) => setTrial(r.trial));
  const apply = () =>
    proposal &&
    run("applying", () => applyFixAction(leadId, message.id, proposal), () => {
      setApplied(true);
      toast("Cambio guardado: la IA ya responde con él");
    });

  const busy = step !== "idle";

  if (applied && proposal) {
    return (
      <section className="rounded-xl bg-emerald-50 p-3.5 ring-1 ring-inset ring-emerald-200">
        <p className="flex gap-2 text-sm text-emerald-900">
          <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-600" />
          Guardado en {proposal.label}. Desde ahora la IA responde con este cambio.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="fix-title" className="rounded-xl bg-white p-3.5 ring-1 ring-inset ring-slate-200">
      <h3 id="fix-title" className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <Wrench aria-hidden className="size-4 text-brand-600" />
        ¿Qué esperabas que respondiera?
      </h3>
      <textarea
        aria-labelledby="fix-title"
        rows={3}
        autoFocus={autoFocus}
        value={expected}
        onChange={(e) => setExpected(e.target.value)}
        placeholder="Ej. como le escribimos nosotros primero, debió hablarle del proyecto en vez de ofrecerle un ejecutivo."
        className={`${inputClass} mt-2`}
      />
      {!proposal && (
        <div className="mt-2">
          {step === "proposing" ? (
            <Working>Buscando dónde corregirlo…</Working>
          ) : (
            <Button size="sm" onClick={propose} disabled={!expected.trim() || busy}>
              <Sparkles aria-hidden />
              Proponer arreglo
            </Button>
          )}
        </div>
      )}
      {error && <div className="mt-2"><FormMessage>{error}</FormMessage></div>}

      {proposal && (
        <div className="mt-3 space-y-3 border-t border-slate-100 pt-3 animate-fade-in">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={proposal.target === "platform" ? "warning" : "brand"}>{proposal.label}</Badge>
          </div>
          <p className="text-[13px] leading-relaxed text-slate-700">{proposal.explanation}</p>

          {proposal.target === "platform" ? (
            <p className="rounded-lg bg-amber-50 p-2.5 text-[13px] leading-relaxed text-amber-900 ring-1 ring-inset ring-amber-200">
              Esto depende de cómo funciona Beliapp, no de lo que configuraste, así que no se corrige desde aquí.
            </p>
          ) : (
            <>
              {proposal.target === "lesson" ? (
                <>
                  <label className="block text-xs font-semibold text-slate-700">
                    Regla para la IA
                    <textarea rows={3} value={proposal.proposed} onChange={(e) => edit({ proposed: e.target.value })} className={`${inputClass} mt-1`} />
                  </label>
                  <label className="block text-xs font-semibold text-slate-700">
                    Mejor así <span className="font-normal text-slate-500">(opcional)</span>
                    <textarea rows={3} value={proposal.goodExample} onChange={(e) => edit({ goodExample: e.target.value })} className={`${inputClass} mt-1`} />
                  </label>
                </>
              ) : (
                <>
                  <div>
                    <p className="mb-1 text-xs font-semibold text-slate-700">Antes y después</p>
                    <DiffView current={proposal.current} proposed={proposal.proposed} />
                  </div>
                  <details>
                    <summary className="cursor-pointer text-[13px] font-medium text-brand-700 hover:underline">Editar el texto antes de probar</summary>
                    <textarea
                      rows={10}
                      value={proposal.proposed}
                      onChange={(e) => edit({ proposed: e.target.value })}
                      className={`${inputClass} mt-2 font-mono text-[13px] leading-relaxed`}
                    />
                  </details>
                </>
              )}

              {trial && <TrialResult before={message.body} trial={trial} />}

              <div className="flex flex-wrap items-center gap-2">
                {step === "trying" ? (
                  <Working>Repitiendo la respuesta con el cambio…</Working>
                ) : step === "applying" ? (
                  <Working>Guardando…</Working>
                ) : (
                  <>
                    <Button size="sm" variant={trial ? "secondary" : "primary"} onClick={tryIt} disabled={busy}>
                      <FlaskConical aria-hidden />
                      {trial ? "Probar de nuevo" : "Probar"}
                    </Button>
                    <Button size="sm" variant={trial ? "primary" : "secondary"} onClick={apply} disabled={busy}>
                      <CircleCheck aria-hidden />
                      Aplicar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={propose} disabled={busy || !expected.trim()}>
                      Proponer otro
                    </Button>
                  </>
                )}
              </div>
              {!trial && <p className="text-xs text-slate-500">Probar repite esta misma respuesta con el cambio, sin enviarle nada al cliente.</p>}
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** La respuesta que dio y la que daría con el cambio, lado a lado (una sobre otra en el teléfono). */
function TrialResult({ before, trial }: { before: string; trial: FixTrial }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 animate-fade-in">
      <div className="rounded-lg bg-slate-50 p-2.5 ring-1 ring-inset ring-slate-200">
        <p className="mb-1 text-xs font-semibold text-slate-600">Respondió</p>
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700">{before}</p>
      </div>
      <div className="rounded-lg bg-emerald-50 p-2.5 ring-1 ring-inset ring-emerald-200">
        <p className="mb-1 text-xs font-semibold text-emerald-800">Con el cambio respondería</p>
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-800">{trial.reply || "(no respondería nada)"}</p>
        {trial.actions.length > 0 && (
          <ul className="mt-2 space-y-0.5 border-t border-emerald-200 pt-1.5 text-xs text-emerald-900">
            {trial.actions.map((a, i) => (
              <li key={i}>Además: {a}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Working({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-slate-600">
      <LoaderCircle aria-hidden className="size-4 animate-spin" />
      {children}
    </p>
  );
}
