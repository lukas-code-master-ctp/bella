"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useFormStatus } from "react-dom";
import { CircleAlert, CircleCheck, X } from "lucide-react";

/**
 * Avisos flotantes (toasts): confirman lo que acaba de pasar ("Cambios guardados") sin mover la
 * página. `toast()` se puede llamar desde cualquier componente de cliente; <Toaster /> va una vez
 * en el layout raíz. Salen arriba, bajo la barra superior, para no tapar la barra de guardar.
 */
type Toast = { id: number; text: string; tone: "success" | "error" };

const DURATION_MS = 4000;
let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function toast(text: string, tone: Toast["tone"] = "success") {
  const id = nextId++;
  // Como mucho tres a la vez; el mismo aviso repetido reemplaza al anterior.
  toasts = [...toasts.filter((t) => t.text !== text).slice(-2), { id, text, tone }];
  emit();
  setTimeout(() => dismissToast(id), DURATION_MS);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const NONE: Toast[] = [];

export function Toaster() {
  const items = useSyncExternalStore(subscribe, () => toasts, () => NONE);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 top-[4.25rem] z-[60] flex flex-col items-center gap-2 md:inset-x-auto md:right-6 md:items-end"
    >
      {items.map((t) => (
        <div
          key={t.id}
          role={t.tone === "error" ? "alert" : "status"}
          className="pointer-events-auto flex w-full max-w-sm animate-rise items-center gap-3 rounded-xl border border-slate-200 bg-white py-3 pl-4 pr-2 text-sm font-medium text-slate-800 shadow-lg shadow-slate-900/10"
        >
          {t.tone === "error" ? (
            <CircleAlert aria-hidden className="size-5 shrink-0 text-rose-600" />
          ) : (
            <CircleCheck aria-hidden className="size-5 shrink-0 text-brand-600" />
          )}
          <span className="min-w-0 flex-1">{t.text}</span>
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            aria-label="Cerrar aviso"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Muestra `text` cuando termina de enviarse el formulario que contiene este componente. */
export function useToastWhenSent(text: string | undefined) {
  const { pending } = useFormStatus();
  const was = useRef(false);
  useEffect(() => {
    if (was.current && !pending && text) toast(text);
    was.current = pending;
  }, [pending, text]);
  // Al borrar o quitar algo, la página se vuelve a pintar sin este botón: deja de existir antes de
  // ver que terminó el envío. Si desaparece mientras enviaba, el envío ya terminó.
  useEffect(() => () => void (was.current && text && toast(text)), [text]);
}

/**
 * Para formularios con useActionState: muestra un aviso según lo que devuelve la acción (por
 * ejemplo "Guardado." → "Cambios guardados") y devuelve el resultado sin cambios.
 */
export function withToast<S, R extends S, P>(
  action: (prev: S, payload: P) => Promise<R>,
  message: (result: R) => string | null,
) {
  return async (prev: S, payload: P): Promise<R> => {
    const result = await action(prev, payload);
    const text = message(result);
    if (text) toast(text);
    return result;
  };
}

/** Las acciones de configuración responden "Guardado." cuando todo salió bien. */
export const isSaved = (m: string | null | undefined) => Boolean(m?.startsWith("Guardado"));
export const savedToast = (m: string | null) => (isSaved(m) ? "Cambios guardados" : null);

