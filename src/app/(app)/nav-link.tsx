"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LinkPending } from "@/components/link-pending";

/**
 * Destino del menú lateral. Con el menú contraído (data-compact en #app-shell) queda solo el
 * ícono: el nombre pasa a ser texto para lectores de pantalla y aparece como globo al pasar el
 * mouse o enfocar; el contador se vuelve una burbuja sobre el ícono.
 */
export function NavLink({
  href,
  icon,
  label,
  badge,
  compactable = false,
  exact = false,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  badge?: React.ReactNode;
  /** Es del menú lateral principal, que se puede contraer (no el de Configuración). */
  compactable?: boolean;
  /** Activo solo en esa ruta exacta, no en las de abajo (la portada de Configuración). */
  exact?: boolean;
}) {
  const pathname = usePathname();
  // Las variantes de "menú contraído" solo valen en el menú principal.
  const c = (cls: string) => (compactable ? cls : "");
  const active = pathname === href || (!exact && pathname.startsWith(`${href}/`));
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`group/link relative flex min-h-10 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 [&_svg]:size-[18px] [&_svg]:shrink-0 ${c("lg:group-data-[compact=true]/shell:justify-center lg:group-data-[compact=true]/shell:px-0")} ${
        active
          ? "bg-brand-50 text-brand-700 [&_svg]:text-brand-600"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 [&_svg]:text-slate-500"
      }`}
    >
      {active && (
        <span
          aria-hidden
          className="absolute inset-y-2 left-0 w-[3px] origin-center animate-indicator rounded-full bg-brand-600"
        />
      )}
      {icon}
      <span className={c("lg:group-data-[compact=true]/shell:sr-only")}>
        {label}
      </span>
      {badge && (
        <span
          className={`ml-auto flex ${c("lg:group-data-[compact=true]/shell:absolute lg:group-data-[compact=true]/shell:-right-1 lg:group-data-[compact=true]/shell:-top-1 lg:group-data-[compact=true]/shell:ml-0")}`}
        >
          {badge}
        </span>
      )}
      {compactable && (
        <span
          aria-hidden
          className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 hidden -translate-y-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white shadow-lg lg:group-data-[compact=true]/shell:group-hover/link:block lg:group-data-[compact=true]/shell:group-focus-visible/link:block"
        >
          {label}
        </span>
      )}
      <LinkPending className="mx-3" />
    </Link>
  );
}
