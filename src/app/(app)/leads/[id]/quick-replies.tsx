"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MessageSquareText, Settings2 } from "lucide-react";
import { matchQuickReplies } from "@/lib/quick-reply-search";

export type QuickReplyOption = { id: string; name: string; body: string };

/**
 * "/" en el campo del ejecutivo: lo escrito desde la barra hasta el cursor filtra sus respuestas
 * rápidas. Se admiten espacios ("/agendar visita") mientras algo coincida.
 */
function slashQuery(el: HTMLTextAreaElement): { start: number; query: string } | null {
  const before = el.value.slice(0, el.selectionStart);
  const m = /(?:^|\s)\/([^\n/]{0,60})$/.exec(before);
  if (!m) return null;
  return { start: before.length - m[1].length - 1, query: m[1] };
}

/** Ajusta el alto del campo a su texto (hasta el máximo que fija la clase). */
export function autoGrow(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  if (el.value) el.style.height = `${el.scrollHeight}px`;
}

/**
 * Menú de respuestas rápidas del campo de texto. Devuelve los manejadores para el textarea y el
 * menú, que se dibuja sobre el campo. `onKeyDown` dice si usó la tecla (para no enviar con Enter).
 */
export function useQuickReplyMenu(replies: QuickReplyOption[], ref: React.RefObject<HTMLTextAreaElement | null>) {
  const [slash, setSlash] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const matches = slash ? matchQuickReplies(replies, slash.query) : [];
  // Con espacios y sin coincidencias ya no se está buscando una respuesta: es texto normal.
  const open = slash !== null && (matches.length > 0 || !slash.query.includes(" "));
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const refresh = () => {
    const el = ref.current;
    const next = el ? slashQuery(el) : null;
    setSlash(next);
    if (next?.query !== slash?.query) setActive(0);
  };

  const pick = (reply: QuickReplyOption) => {
    const el = ref.current;
    if (!el || !slash) return;
    const end = el.selectionStart;
    el.value = el.value.slice(0, slash.start) + reply.body + el.value.slice(end);
    const caret = slash.start + reply.body.length;
    el.focus();
    el.setSelectionRange(caret, caret);
    autoGrow(el);
    setSlash(null);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open || e.nativeEvent.isComposing) return false;
    if (e.key === "Escape") {
      setSlash(null);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!matches.length) return false;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + matches.length) % matches.length);
    } else if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
      if (!matches.length) return false;
      pick(matches[Math.min(active, matches.length - 1)]);
    } else {
      return false;
    }
    e.preventDefault();
    return true;
  };

  const menu = open ? (
    <div
      className="absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg animate-fade-in"
      // Que el clic no le quite el foco al campo antes de elegir.
      onMouseDown={(e) => e.preventDefault()}
    >
      <p className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-500">
        <MessageSquareText aria-hidden className="size-3.5" />
        Respuestas rápidas
      </p>
      {matches.length > 0 ? (
        <ul ref={listRef} id="quick-reply-list" role="listbox" aria-label="Respuestas rápidas" className="max-h-64 overflow-y-auto py-1">
          {matches.map((r, i) => (
            <li
              key={r.id}
              id={`quick-reply-${r.id}`}
              role="option"
              aria-selected={i === active}
              data-index={i}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(r)}
              className={`cursor-pointer px-3 py-2 ${i === active ? "bg-brand-50" : ""}`}
            >
              <p className="truncate text-sm font-medium text-slate-900">/{r.name}</p>
              <p className="line-clamp-2 text-xs text-slate-600">{r.body}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-3 py-3 text-sm text-slate-600">
          {replies.length === 0 ? "Aún no tienes respuestas rápidas." : `Ninguna respuesta coincide con "${slash?.query}".`}
        </p>
      )}
      <Link
        href="/profile#respuestas-rapidas"
        className="flex items-center gap-2 border-t border-slate-100 px-3 py-2 text-xs font-medium text-brand-700 hover:bg-slate-50"
      >
        <Settings2 aria-hidden className="size-3.5" />
        {replies.length === 0 ? "Crear respuestas en Mi perfil" : "Administrar mis respuestas"}
      </Link>
    </div>
  ) : null;

  const activeId = open && matches[active] ? `quick-reply-${matches[active].id}` : undefined;
  return {
    menu,
    onKeyDown,
    refresh,
    close: () => setSlash(null),
    ariaProps: { role: "combobox" as const, "aria-autocomplete": "list" as const, "aria-expanded": open, "aria-controls": open ? "quick-reply-list" : undefined, "aria-activedescendant": activeId },
  };
}
