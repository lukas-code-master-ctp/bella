"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { draftReplyAction } from "./actions";
import { autoGrow } from "./quick-replies";

/** "@ia" escrito como palabra, en cualquier parte del campo. */
const AI_MENTION = /(^|\s)@ia\b/i;

export function hasAiMention(text: string) {
  return AI_MENTION.test(text);
}

/**
 * "@ia" en el campo del ejecutivo: aparece el botón Redactar y la IA escribe la respuesta según la
 * conversación (lo demás que se escribió es la indicación, p. ej. "@ia dile que el viernes hay
 * visita"). El borrador reemplaza el texto del campo y nunca se envía solo.
 */
export function useAiDraft(leadId: string, ref: React.RefObject<HTMLTextAreaElement | null>, onError: (e: string | null) => void) {
  const [mentioned, setMentioned] = useState(false);
  const [drafting, startDraft] = useTransition();

  const refresh = () => setMentioned(hasAiMention(ref.current?.value ?? ""));

  const draft = () => {
    const el = ref.current;
    if (!el || drafting) return;
    const hint = el.value.replace(/(^|\s)@ia\b/gi, " ").replace(/\s+/g, " ").trim();
    onError(null);
    startDraft(async () => {
      try {
        const result = await draftReplyAction(leadId, hint);
        if (result.error !== undefined) return onError(result.error);
        el.value = result.draft;
        autoGrow(el);
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
        setMentioned(false);
      } catch (err) {
        console.error(err);
        onError("No se pudo redactar. Revisa tu conexión e intenta de nuevo.");
      }
    });
  };

  const button =
    mentioned || drafting ? (
      <button
        type="button"
        onClick={draft}
        disabled={drafting}
        className="absolute bottom-full left-0 z-10 mb-2 inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white shadow-md transition-opacity duration-150 animate-fade-in hover:bg-brand-700 disabled:opacity-80"
      >
        <Sparkles aria-hidden className={`size-3.5 ${drafting ? "animate-pulse" : ""}`} />
        {drafting ? "Redactando…" : "Redactar con IA"}
      </button>
    ) : null;

  return { button, refresh, draft, drafting, mentioned };
}
