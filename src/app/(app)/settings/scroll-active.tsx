"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/** En móvil el menú de Configuración es una tira horizontal: deja a la vista la pestaña activa. */
export function ScrollActiveIntoView() {
  const pathname = usePathname();
  useEffect(() => {
    if (window.matchMedia("(min-width: 768px)").matches) return;
    const link = document.querySelector<HTMLElement>('nav[aria-label="Configuración"] [aria-current="page"]');
    const strip = link?.closest<HTMLElement>("[data-strip]");
    if (!link || !strip) return;
    strip.scrollTo({ left: link.offsetLeft - strip.clientWidth / 2 + link.clientWidth / 2, behavior: "smooth" });
  }, [pathname]);
  return null;
}
