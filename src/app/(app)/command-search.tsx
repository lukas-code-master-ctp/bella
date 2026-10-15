"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleX, Search, Trophy } from "lucide-react";
import { Avatar } from "@/components/ui";
import { CHANNEL_LABEL } from "@/lib/labels";
import type { SearchHit } from "@/lib/domain/search";
import { searchLeadsAction } from "./search-actions";

/**
 * Búsqueda global de leads por nombre, teléfono o correo. Se abre con el botón de la barra
 * superior o con ⌘K / Ctrl+K desde cualquier pantalla; Enter abre la ficha del elegido.
 */
export function CommandSearch({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searched, setSearched] = useState("");
  const [active, setActive] = useState(0);
  const [pending, start] = useTransition();
  const [mac, setMac] = useState(false);

  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform));
    // Hay dos botones (el de la barra superior y el ícono del encabezado móvil): solo el de la
    // barra atiende el atajo, para que no se abran dos buscadores a la vez.
    if (compact) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [compact]);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      inputRef.current?.select();
    } else if (!open && d.open) d.close();
  }, [open]);

  // Busca 200 ms después de la última tecla; descarta respuestas de búsquedas anteriores.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setSearched("");
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      start(async () => {
        const result = await searchLeadsAction(q);
        if (!live) return;
        setHits(result);
        setSearched(q);
        setActive(0);
      });
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  function go(hit: SearchHit | undefined) {
    if (!hit) return;
    setOpen(false);
    router.push(`/leads/${hit.id}`);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (hits.length) setActive((i) => (i + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(hits[active]);
    }
  }

  const tooShort = query.trim().length < 2;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Buscar lead"
        aria-keyshortcuts="Meta+K Control+K"
        className={
          compact
            ? "flex size-10 items-center justify-center rounded-lg text-slate-600 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-900"
            : "flex h-9 w-full max-w-md items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500 transition-colors duration-150 hover:border-slate-300 hover:bg-white"
        }
      >
        <Search aria-hidden className="size-4 shrink-0" />
        {!compact && (
          <>
            <span className="truncate">Buscar lead, teléfono o correo…</span>
            <kbd className="ml-auto rounded border border-slate-200 bg-white px-1.5 font-sans text-[11px] font-medium text-slate-500">
              {mac ? "⌘K" : "Ctrl K"}
            </kbd>
          </>
        )}
      </button>

      <dialog
        ref={dialogRef}
        onClose={() => setOpen(false)}
        onClick={(e) => e.target === dialogRef.current && setOpen(false)}
        aria-label="Buscar lead"
        className="mx-auto mt-[12dvh] w-[calc(100%-2rem)] max-w-xl rounded-2xl bg-white p-0 shadow-2xl backdrop:bg-slate-900/40 open:animate-pop"
      >
        <div className="flex items-center gap-3 border-b border-slate-200 px-4">
          <Search aria-hidden className={`size-5 shrink-0 ${pending ? "animate-pulse text-brand-600" : "text-slate-400"}`} />
          <input
            ref={inputRef}
            type="text"
            enterKeyHint="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Nombre, teléfono o correo"
            aria-label="Buscar lead por nombre, teléfono o correo"
            role="combobox"
            aria-expanded={hits.length > 0}
            aria-controls="search-results"
            aria-activedescendant={hits[active] ? `hit-${hits[active].id}` : undefined}
            autoComplete="off"
            spellCheck={false}
            className="h-14 min-w-0 flex-1 bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-400"
          />
          <kbd className="rounded border border-slate-200 px-1.5 text-[11px] font-medium text-slate-500">Esc</kbd>
        </div>
        <div className="max-h-[60dvh] overflow-y-auto p-2">
          {tooShort ? (
            <p className="px-3 py-6 text-center text-sm text-slate-500">Escribe al menos 2 letras o 3 dígitos del teléfono.</p>
          ) : hits.length === 0 && searched === query.trim() && !pending ? (
            <p className="px-3 py-6 text-center text-sm text-slate-500" role="status">
              Ningún lead calza con “{searched}”.
            </p>
          ) : (
            <ul id="search-results" role="listbox" aria-label="Leads encontrados">
              {hits.map((h, i) => (
                <li
                  key={h.id}
                  id={`hit-${h.id}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={() => go(h)}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 ${i === active ? "bg-brand-50" : ""}`}
                >
                  <Avatar name={h.name} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-900">{h.name}</span>
                    <span className="block truncate text-xs text-slate-600">
                      {[h.detail, CHANNEL_LABEL[h.channel], h.stage].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {h.status === "WON" && (
                    <span className="flex items-center gap-1 text-xs font-medium text-emerald-700">
                      <Trophy aria-hidden className="size-3.5" />
                      Ganado
                    </span>
                  )}
                  {h.status === "LOST" && (
                    <span className="flex items-center gap-1 text-xs font-medium text-rose-700">
                      <CircleX aria-hidden className="size-3.5" />
                      Perdido
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </dialog>
    </>
  );
}
