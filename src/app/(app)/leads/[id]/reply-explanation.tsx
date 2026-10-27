"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CircleHelp, LoaderCircle, Pencil, Sparkles, TriangleAlert } from "lucide-react";
import type { Citation, ReplyAnalysis, SourceKind } from "@/lib/domain/reply-analysis";
import { Badge, Button, FormMessage } from "@/components/ui";
import { explainReplyAction } from "./actions";

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
 * "¿Por qué respondió esto?": la IA lee lo que se guardó del turno y explica la respuesta, citando
 * los fragmentos de la configuración que más pesaron, con un enlace para editarlos.
 */
export function ReplyExplanation({ leadId, messageId }: { leadId: string; messageId: string }) {
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
    <section aria-labelledby="explain-title" className="mb-4 rounded-xl bg-brand-50/60 p-3.5 ring-1 ring-inset ring-brand-100">
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
