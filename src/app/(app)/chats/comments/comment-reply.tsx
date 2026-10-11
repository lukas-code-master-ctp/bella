"use client";

import { useActionState, useTransition, useState } from "react";
import { Eye, EyeOff, MessageCircle, Send } from "lucide-react";
import { Button, FormMessage, inputClass } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { hideCommentAction, replyCommentAction } from "./actions";

/** Respuesta a un comentario: en público o por mensaje privado al autor. */
export function CommentReply({ commentId, canPrivate, hidden }: { commentId: string; canPrivate: boolean; hidden: boolean }) {
  const [error, action] = useActionState(replyCommentAction.bind(null, commentId), null);
  const [hideError, setHideError] = useState<string | null>(null);
  const [hiding, startHiding] = useTransition();
  return (
    <form action={action} className="mt-3 space-y-2">
      <label htmlFor={`reply-${commentId}`} className="sr-only">
        Respuesta
      </label>
      <textarea id={`reply-${commentId}`} name="text" rows={2} required placeholder="Escribe la respuesta…" className={inputClass} />
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton name="mode" value="public" size="sm" pendingText="Enviando…">
          <Send aria-hidden />
          Responder en público
        </SubmitButton>
        {canPrivate && (
          <SubmitButton name="mode" value="private" size="sm" variant="secondary" pendingText="Enviando…">
            <MessageCircle aria-hidden />
            Enviar por privado
          </SubmitButton>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={hiding}
          onClick={() => startHiding(async () => setHideError(await hideCommentAction(commentId, !hidden)))}
        >
          {hidden ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
          {hidden ? "Mostrar" : "Ocultar"}
        </Button>
      </div>
      {(error || hideError) && <FormMessage>{error ?? hideError}</FormMessage>}
    </form>
  );
}
