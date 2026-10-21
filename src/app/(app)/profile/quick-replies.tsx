"use client";

import { useActionState, useState, useTransition } from "react";
import { MessageSquareText, Plus, Save, Trash2 } from "lucide-react";
import { Button, EmptyState, Field, FormMessage, inputClass } from "@/components/ui";
import { Disclosure, PanelBody } from "@/components/settings-ui";
import { SubmitButton } from "@/components/submit-button";
import { toast, withToast } from "@/components/toast";
import { QUICK_REPLY_BODY_MAX, QUICK_REPLY_NAME_MAX } from "@/lib/quick-reply-search";
import { deleteQuickReplyAction, saveQuickReplyAction, type ProfileState } from "./actions";

type Reply = { id: string; name: string; body: string };

/** Lista de respuestas rápidas propias: cada una se abre para editarla y abajo se crea una nueva. */
export function QuickReplies({ replies }: { replies: Reply[] }) {
  const [adding, setAdding] = useState(replies.length === 0);
  return (
    <PanelBody>
      {replies.length === 0 && !adding && (
        <EmptyState icon={<MessageSquareText />} title="Aún no tienes respuestas rápidas" />
      )}
      {replies.length > 0 && (
        <ul className="space-y-2">
          {replies.map((r) => (
            <li key={r.id}>
              <Disclosure
                summary={
                  <>
                    <p className="truncate font-medium text-slate-900">/{r.name}</p>
                    <p className="truncate text-sm text-slate-600">{r.body}</p>
                  </>
                }
              >
                <ReplyForm reply={r} />
              </Disclosure>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-4">
          <ReplyForm reply={null} onDone={() => setAdding(false)} />
        </div>
      ) : (
        <Button type="button" variant="secondary" onClick={() => setAdding(true)}>
          <Plus aria-hidden />
          Nueva respuesta
        </Button>
      )}
    </PanelBody>
  );
}

function ReplyForm({ reply, onDone }: { reply: Reply | null; onDone?: () => void }) {
  const [state, action] = useActionState(
    withToast(saveQuickReplyAction.bind(null, reply?.id ?? null), (s: ProfileState) => {
      if (s?.ok && !reply) onDone?.();
      return s?.ok ? s.message : null;
    }),
    null,
  );
  const [deleting, startDelete] = useTransition();
  return (
    <form action={action} className="space-y-4">
      <Field label="Nombre" hint='Con este nombre la buscas en el chat, por ejemplo "/saludo".'>
        <input name="name" required maxLength={QUICK_REPLY_NAME_MAX} defaultValue={reply?.name} placeholder="Saludo" className={inputClass} />
      </Field>
      <Field label="Mensaje">
        <textarea
          name="body"
          required
          rows={4}
          maxLength={QUICK_REPLY_BODY_MAX}
          defaultValue={reply?.body}
          placeholder="Hola, gracias por escribirnos. ¿En qué te puedo ayudar?"
          className={inputClass}
        />
      </Field>
      {state && !state.ok && <FormMessage>{state.message}</FormMessage>}
      <div className="flex flex-wrap justify-end gap-2">
        {reply ? (
          <Button
            type="button"
            variant="ghost-danger"
            disabled={deleting}
            onClick={() => {
              if (!window.confirm(`¿Borrar la respuesta "/${reply.name}"?`)) return;
              startDelete(async () => {
                await deleteQuickReplyAction(reply.id);
                toast("Respuesta borrada");
              });
            }}
          >
            <Trash2 aria-hidden />
            {deleting ? "Borrando…" : "Borrar"}
          </Button>
        ) : (
          onDone && (
            <Button type="button" variant="ghost" onClick={onDone}>
              Cancelar
            </Button>
          )
        )}
        <SubmitButton pendingText="Guardando…">
          <Save aria-hidden />
          {reply ? "Guardar" : "Crear respuesta"}
        </SubmitButton>
      </div>
    </form>
  );
}
