"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "./ui";

// Errores típicos de una pestaña abierta con una versión anterior de la app: tras un deploy,
// los archivos JS y los ids de las server actions cambian y la pestaña vieja ya no los encuentra.
const STALE_DEPLOY = /ChunkLoadError|Loading (CSS )?chunk|dynamically imported module|Server Action .* was not found|older or newer deployment/i;
const RELOADED_KEY = "bella:reloaded-after-deploy";

export function isStaleDeployError(error: Error) {
  return STALE_DEPLOY.test(`${error.name} ${error.message}`);
}

/**
 * Pantalla de error con opción de reintentar. Si el error viene de una versión anterior de la
 * app, recarga la página una vez para traer la nueva (sin entrar en un bucle de recargas).
 */
export function ErrorScreen({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const stale = isStaleDeployError(error);

  useEffect(() => {
    console.error(error);
    if (!stale) return;
    try {
      if (sessionStorage.getItem(RELOADED_KEY)) return;
      sessionStorage.setItem(RELOADED_KEY, "1");
    } catch {
      return;
    }
    window.location.reload();
  }, [error, stale]);

  useEffect(() => {
    // Si la página carga bien un rato después, se permite volver a recargar en el próximo deploy.
    const timer = setTimeout(() => {
      try {
        sessionStorage.removeItem(RELOADED_KEY);
      } catch {}
    }, 10_000);
    return () => clearTimeout(timer);
  }, []);

  function retry() {
    if (stale) return window.location.reload();
    // Vuelve a pedir los datos al servidor y re-renderiza el segmento que falló.
    startTransition(() => {
      router.refresh();
      reset();
    });
  }

  return (
    <div role="alert" className="flex min-h-[60dvh] flex-col items-center justify-center px-6 py-10 text-center">
      <span className="mb-4 flex size-12 items-center justify-center rounded-full bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200">
        <TriangleAlert aria-hidden className="size-6" />
      </span>
      <h1 className="text-lg font-semibold text-slate-900">{stale ? "Hay una versión nueva de Bella" : "Algo salió mal"}</h1>
      <p className="mt-1 max-w-md text-sm text-slate-600">
        {stale
          ? "Recarga la página para seguir trabajando con la última versión."
          : "No pudimos completar la acción. Vuelve a intentarlo; si el problema sigue, avísanos."}
      </p>
      <Button className="mt-5" onClick={retry} disabled={pending} aria-busy={pending}>
        <RotateCcw aria-hidden />
        {stale ? "Recargar" : "Reintentar"}
      </Button>
      {error.digest && <p className="mt-4 text-xs text-slate-400">Código: {error.digest}</p>}
    </div>
  );
}
