"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clock, FileText, Send, X } from "lucide-react";
import { Button, FormMessage, inputClass } from "@/components/ui";
import { toast } from "@/components/toast";
import { chatTemplatesAction, sendTemplateAction } from "./actions";

type ChatTemplate = Extract<Awaited<ReturnType<typeof chatTemplatesAction>>, { templates: unknown }>["templates"][number];

const fill = (body: string, params: string[]) => body.replace(/\{\{\s*(\d+)\s*\}\}/g, (all, n: string) => params[Number(n) - 1] || all);

/**
 * Reemplaza al compositor cuando pasaron más de 24 h desde el último mensaje del cliente: el canal
 * ya no deja mandar texto, audio ni archivos. En WhatsApp se puede retomar con una plantilla.
 */
export function ClosedWindowComposer({
  leadId,
  channelName,
  templatesAllowed,
  contactName,
  isAdmin,
}: {
  leadId: string;
  channelName: string;
  templatesAllowed: boolean;
  contactName: string;
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-amber-50 p-3 ring-1 ring-inset ring-amber-200 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 gap-2.5 text-sm text-slate-700">
        <Clock aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-600" />
        <p>
          <span className="font-semibold text-slate-900">Pasaron más de 24 horas desde el último mensaje del cliente.</span>{" "}
          {templatesAllowed
            ? `${channelName} solo deja escribirle con una plantilla aprobada. Cuando responda, vuelves a escribirle libremente.`
            : `${channelName} no deja escribirle hasta que vuelva a escribir.`}
        </p>
      </div>
      {templatesAllowed && (
        <Button type="button" onClick={() => setOpen(true)} className="shrink-0">
          <FileText aria-hidden />
          Enviar plantilla
        </Button>
      )}
      {templatesAllowed && (
        <TemplateDialog leadId={leadId} contactName={contactName} isAdmin={isAdmin} open={open} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}

function TemplateDialog({ leadId, contactName, isAdmin, open, onClose }: { leadId: string; contactName: string; isAdmin: boolean; open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby="template-dialog-title"
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl bg-white p-0 shadow-xl backdrop:bg-slate-900/40 open:animate-pop"
    >
      {open && <TemplateForm leadId={leadId} contactName={contactName} isAdmin={isAdmin} onClose={onClose} />}
    </dialog>
  );
}

function TemplateForm({ leadId, contactName, isAdmin, onClose }: { leadId: string; contactName: string; isAdmin: boolean; onClose: () => void }) {
  const router = useRouter();
  const [templates, setTemplates] = useState<ChatTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<ChatTemplate | null>(null);
  const [params, setParams] = useState<string[]>([]);
  const [sending, startSending] = useTransition();
  const firstName = contactName.trim().split(/\s+/)[0] ?? "";

  useEffect(() => {
    let alive = true;
    chatTemplatesAction(leadId)
      .then((res) => {
        if (!alive) return;
        if ("error" in res) setError(res.error);
        else setTemplates(res.templates);
      })
      .catch(() => alive && setError("No se pudieron leer las plantillas de Meta."));
    return () => {
      alive = false;
    };
  }, [leadId]);

  const choose = (t: ChatTemplate) => {
    setPicked(t);
    // {{1}} suele ser el nombre del cliente: se propone, y se puede cambiar.
    setParams(Array.from({ length: t.params }, (_, i) => (i === 0 ? firstName : "")));
    setError(null);
  };

  const send = () => {
    if (!picked) return;
    startSending(async () => {
      try {
        const failed = await sendTemplateAction(leadId, { name: picked.name, language: picked.language, params });
        router.refresh();
        if (failed) return setError(failed);
        toast("Plantilla enviada");
        onClose();
      } catch (err) {
        console.error(err);
        setError("No se pudo enviar. Revisa tu conexión e intenta de nuevo.");
      }
    });
  };

  const usable = templates?.filter((t) => !t.unsupported) ?? [];
  const missing = picked ? params.some((p) => !p.trim()) : true;

  return (
    <div className="flex max-h-[85dvh] flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <h2 id="template-dialog-title" className="text-base font-semibold text-slate-900">
          Enviar plantilla
        </h2>
        <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Cerrar" disabled={sending}>
          <X aria-hidden />
        </Button>
      </div>

      <div className="space-y-4 overflow-y-auto px-5 py-4">
        <p className="text-sm text-slate-600">Elige una plantilla aprobada en Meta para retomar la conversación. Al enviarla, la IA se pausa.</p>

        {templates === null && !error && <p className="text-sm text-slate-500">Cargando plantillas…</p>}

        {templates && usable.length === 0 && (
          <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
            No hay plantillas aprobadas que se puedan enviar desde el chat.{" "}
            {isAdmin ? (
              <Link href="/broadcasts/templates" className="font-medium text-brand-700 underline-offset-2 hover:underline">
                Crear una en Plantillas
              </Link>
            ) : (
              "Pídele a un admin que cree una en Envíos masivos → Plantillas."
            )}
          </p>
        )}

        {templates && templates.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="sr-only">Plantilla</legend>
            {templates.map((t) => {
              const id = `tpl-${t.name}-${t.language}`;
              const selected = picked?.name === t.name && picked.language === t.language;
              return (
                <label
                  key={id}
                  htmlFor={id}
                  className={`block rounded-lg p-3 ring-1 ring-inset transition-colors duration-150 ${
                    t.unsupported
                      ? "cursor-not-allowed bg-slate-50 text-slate-400 ring-slate-200"
                      : selected
                        ? "cursor-pointer bg-brand-50 ring-brand-500"
                        : "cursor-pointer ring-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <input
                      id={id}
                      type="radio"
                      name="template"
                      checked={selected}
                      disabled={Boolean(t.unsupported) || sending}
                      onChange={() => choose(t)}
                      className="accent-brand-600"
                    />
                    <span className="truncate text-sm font-medium text-slate-900">{t.name}</span>
                    <span className="text-xs text-slate-500">{t.language}</span>
                  </span>
                  <span className="mt-1 line-clamp-2 block whitespace-pre-line text-[13px] text-slate-600">{t.body}</span>
                  {t.unsupported && <span className="mt-1 block text-xs text-slate-500">{t.unsupported}</span>}
                </label>
              );
            })}
          </fieldset>
        )}

        {picked && picked.params > 0 && (
          <div className="space-y-3">
            {params.map((value, i) => (
              <div key={i}>
                <label htmlFor={`tpl-param-${i}`} className="mb-1 block text-sm font-medium text-slate-700">
                  {`Variable {{${i + 1}}}`}
                </label>
                <input
                  id={`tpl-param-${i}`}
                  value={value}
                  disabled={sending}
                  onChange={(e) => setParams((list) => list.map((p, j) => (j === i ? e.target.value : p)))}
                  className={inputClass}
                />
              </div>
            ))}
          </div>
        )}

        {picked && (
          <div>
            <p className="mb-1 text-sm font-medium text-slate-700">Así le llegará</p>
            <p className="whitespace-pre-line rounded-lg bg-emerald-50 p-3 text-sm text-slate-800 ring-1 ring-inset ring-emerald-200">{fill(picked.body, params)}</p>
          </div>
        )}

        {error && <FormMessage>{error}</FormMessage>}
      </div>

      <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
        <Button type="button" variant="secondary" onClick={onClose} disabled={sending}>
          Cancelar
        </Button>
        <Button type="button" onClick={send} disabled={!picked || missing || sending}>
          <Send aria-hidden />
          {sending ? "Enviando…" : "Enviar plantilla"}
        </Button>
      </div>
    </div>
  );
}
