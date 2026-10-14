"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Vuelve a pedir los datos de la página (router.refresh) cada `seconds` mientras la pestaña
 * está visible, al volver a ella y cuando llega un aviso push. Así un lead o mensaje nuevo
 * aparece sin recargar; el estado de los componentes cliente se conserva.
 */
export function AutoRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter();

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = setInterval(refresh, seconds * 1000);
    document.addEventListener("visibilitychange", refresh);
    navigator.serviceWorker?.addEventListener("message", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      navigator.serviceWorker?.removeEventListener("message", refresh);
    };
  }, [router, seconds]);

  return null;
}
