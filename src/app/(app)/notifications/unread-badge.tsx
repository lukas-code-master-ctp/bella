"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { unreadCountAction } from "./actions";

/**
 * Contador de avisos sin leer. Se actualiza al navegar, al volver a la pestaña y cada 30 s;
 * cuando cambia el número, el globo hace un pequeño rebote (la key lo vuelve a montar).
 */
export function UnreadBadge({ initial }: { initial: number }) {
  const [count, setCount] = useState(initial);
  const pathname = usePathname();

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      unreadCountAction()
        .then((n) => alive && setCount(n))
        .catch(() => {});
    };
    refresh();
    const timer = setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    navigator.serviceWorker?.addEventListener("message", refresh);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      navigator.serviceWorker?.removeEventListener("message", refresh);
    };
  }, [pathname]);

  if (count === 0) return null;
  return (
    <span key={count} className="ml-auto min-w-5 animate-pop rounded-full bg-brand-600 px-1.5 py-0.5 text-center text-[11px] font-semibold leading-4 text-white">
      <span className="sr-only">, sin leer: </span>
      {count > 99 ? "99+" : count}
    </span>
  );
}
