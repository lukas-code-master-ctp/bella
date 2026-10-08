import type { ComponentProps, ReactNode } from "react";
import { X } from "lucide-react";

// Altura mínima 40px y texto de 16px en móvil (evita el zoom automático de iOS).
export const inputClass =
  "block min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-xs transition-colors duration-150 placeholder:text-slate-400 hover:border-slate-400 focus:border-brand-500 focus:outline-none focus:ring-3 focus:ring-brand-500/20 disabled:bg-slate-50 disabled:text-slate-500 sm:text-sm";

const variants = {
  primary: "bg-brand-600 text-white shadow-sm hover:bg-brand-700 active:bg-brand-800",
  secondary: "border border-slate-300 bg-white text-slate-700 shadow-xs hover:border-slate-400 hover:bg-slate-50 active:bg-slate-100",
  danger: "bg-rose-600 text-white shadow-sm hover:bg-rose-700 active:bg-rose-800",
  success: "bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 active:bg-emerald-800",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900 active:bg-slate-200",
  "ghost-danger": "text-rose-700 hover:bg-rose-50 active:bg-rose-100",
};

const sizes = {
  md: "min-h-10 px-4 py-2 text-sm",
  sm: "min-h-8 px-3 py-1.5 text-xs",
  icon: "size-10 p-0",
};

export type ButtonVariant = keyof typeof variants;

export function buttonClass(variant: ButtonVariant = "primary", size: keyof typeof sizes = "md", className = "") {
  return `inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-semibold transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 ${variants[variant]} ${sizes[size]} ${className}`;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: keyof typeof sizes }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

export function Card({ className = "", ...props }: ComponentProps<"div">) {
  return <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`} {...props} />;
}

export function CardHeader({ title, description, icon, children }: { title: string; description?: ReactNode; icon?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start gap-3">
      {icon && (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 [&_svg]:size-5">
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-slate-600">{description}</p>}
      </div>
      {children}
    </div>
  );
}

export function PageHeader({ title, description, children }: { title: string; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-slate-600">{description}</p>}
      </div>
      {children}
    </div>
  );
}

const tones = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  brand: "bg-brand-50 text-brand-700 ring-brand-200",
  success: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  danger: "bg-rose-50 text-rose-800 ring-rose-200",
  warning: "bg-amber-50 text-amber-800 ring-amber-200",
};

export function Badge({ tone = "neutral", className = "", children }: { tone?: keyof typeof tones; className?: string; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset [&_svg]:size-3.5 ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** Etiqueta con su color como punto: el texto queda siempre legible, sea cual sea el color elegido. */
export function TagPill({ label, color, removable }: { label: string; color: string; removable?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 py-0.5 pl-2 pr-2.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-200">
      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      {label}
      {removable && <X aria-hidden className="-mr-1 size-3.5 text-slate-500 group-hover:text-rose-700" />}
    </span>
  );
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const cls = { sm: "size-6 text-[10px]", md: "size-8 text-xs", lg: "size-10 text-sm" }[size];
  return (
    <span aria-hidden className={`inline-flex shrink-0 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-800 ${cls}`}>
      {initials(name) || "?"}
    </span>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <span className="mb-3 flex size-11 items-center justify-center rounded-full bg-slate-100 text-slate-500 [&_svg]:size-5">{icon}</span>
      <p className="font-semibold text-slate-900">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-slate-600">{children}</div>}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-slate-800">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-600">{hint}</span>}
    </label>
  );
}

/** Mensaje de error o confirmación de un formulario, anunciado a lectores de pantalla. */
export function FormMessage({ tone = "danger", children }: { tone?: "danger" | "neutral"; children: ReactNode }) {
  return (
    <p role={tone === "danger" ? "alert" : "status"} className={`text-sm ${tone === "danger" ? "text-rose-700" : "text-slate-700"}`}>
      {children}
    </p>
  );
}

/** Bloque gris con brillo animado que ocupa el lugar del contenido mientras carga. */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-shimmer rounded-lg bg-[linear-gradient(90deg,var(--color-slate-200)_25%,var(--color-slate-100)_50%,var(--color-slate-200)_75%)] bg-[length:200%_100%] ${className}`}
    />
  );
}

/** Contenedor de una pantalla de carga: lo anuncia a lectores de pantalla y aparece con un fundido. */
export function LoadingScreen({ label = "Cargando…", children }: { label?: string; children: ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="animate-fade-in">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** Esqueleto del encabezado de página (título, descripción y acción). */
export function PageHeaderSkeleton({ action = true }: { action?: boolean }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-2.5">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80 max-w-[70vw]" />
      </div>
      {action && <Skeleton className="h-10 w-44" />}
    </div>
  );
}
