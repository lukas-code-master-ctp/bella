import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";
import { Check, ChevronDown, CircleCheck, CircleDashed, Info, TriangleAlert } from "lucide-react";
import { Badge, Card } from "./ui";

// Controles de formulario con más vida que los nativos, pero que siguen siendo <input> reales:
// funcionan en formularios de server actions sin JavaScript y mandan los mismos valores que antes
// (una casilla marcada manda "on", o su `value`).

const iconTile = "flex size-9 shrink-0 items-center justify-center rounded-lg [&_svg]:size-[18px]";

/** Interruptor encendido/apagado. Es una casilla (`type="checkbox"`), así que en el formulario manda "on". */
export function Switch({ className = "", ...props }: Omit<ComponentProps<"input">, "type">) {
  return (
    <span className={`relative inline-flex h-6 w-11 shrink-0 ${className}`}>
      <input
        type="checkbox"
        role="switch"
        className="peer absolute inset-0 z-10 m-0 size-full cursor-pointer appearance-none rounded-full disabled:cursor-not-allowed"
        {...props}
      />
      <span
        aria-hidden
        className="absolute inset-0 rounded-full bg-slate-300 transition-colors duration-200 peer-checked:bg-brand-600 peer-hover:bg-slate-400 peer-checked:peer-hover:bg-brand-700 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-600 peer-disabled:opacity-50"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow-sm ring-1 ring-black/5 transition-[translate] duration-200 ease-[var(--ease-spring)] peer-checked:translate-x-5"
      />
    </span>
  );
}

/** Fila con título, descripción e interruptor a la derecha; toda la fila es clicable. */
export function ToggleRow({
  title,
  description,
  icon,
  className = "",
  ...input
}: Omit<ComponentProps<"input">, "type" | "title"> & { title: ReactNode; description?: ReactNode; icon?: ReactNode }) {
  return (
    <label
      className={`group flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 transition-colors duration-150 hover:border-slate-300 has-[:checked]:border-brand-200 has-[:checked]:bg-brand-50/50 ${className}`}
    >
      {icon && (
        <span className={`${iconTile} bg-slate-100 text-slate-500 transition-colors duration-150 group-has-[:checked]:bg-brand-100 group-has-[:checked]:text-brand-700`}>
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-slate-900">{title}</span>
        {description && <span className="mt-0.5 block text-sm text-slate-600">{description}</span>}
      </span>
      <Switch className="mt-0.5" {...input} />
    </label>
  );
}

/**
 * Opción en forma de tarjeta (radio o casilla). La elegida se marca con el color de marca y un check.
 * Acepta las props del <input>, así que sirve controlada (`checked`/`onChange`) o no (`defaultChecked`).
 */
export function ChoiceCard({
  title,
  description,
  icon,
  type = "radio",
  className = "",
  ...input
}: Omit<ComponentProps<"input">, "type" | "title"> & {
  type?: "radio" | "checkbox";
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <label
      className={`group relative flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white p-3.5 transition-[border-color,background-color,box-shadow] duration-150 hover:border-slate-300 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50/60 has-[:checked]:shadow-[0_0_0_1px_var(--color-brand-500)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600 ${className}`}
    >
      <input type={type} className="peer sr-only" {...input} />
      {icon && (
        <span className={`${iconTile} bg-slate-100 text-slate-500 transition-colors duration-150 group-has-[:checked]:bg-brand-600 group-has-[:checked]:text-white`}>
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 pr-5">
        <span className="block text-sm font-semibold text-slate-900">{title}</span>
        {description && <span className="mt-0.5 block text-xs leading-relaxed text-slate-600">{description}</span>}
      </span>
      <span
        aria-hidden
        className="absolute right-3 top-3 flex size-5 items-center justify-center rounded-full border border-slate-300 bg-white text-white transition-[background-color,border-color,scale] duration-150 group-has-[:checked]:scale-100 group-has-[:checked]:border-brand-600 group-has-[:checked]:bg-brand-600"
      >
        <Check className="size-3 opacity-0 transition-opacity duration-150 group-has-[:checked]:opacity-100" strokeWidth={3} />
      </span>
    </label>
  );
}

/** Pastilla seleccionable (días, canales, etapas). Casilla por defecto; `type="radio"` para elegir una. */
export function Chip({
  children,
  type = "checkbox",
  className = "",
  ...input
}: Omit<ComponentProps<"input">, "type"> & { type?: "radio" | "checkbox"; children: ReactNode }) {
  return (
    <label
      className={`group inline-flex min-h-9 cursor-pointer select-none items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-700 transition-[color,background-color,border-color,scale] duration-150 hover:border-slate-400 hover:bg-slate-50 active:scale-[0.97] has-[:checked]:border-brand-600 has-[:checked]:bg-brand-600 has-[:checked]:text-white has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600 [&_svg]:size-3.5 ${className}`}
    >
      <input type={type} className="sr-only" {...input} />
      <Check aria-hidden className="-ml-0.5 hidden group-has-[:checked]:block" strokeWidth={3} />
      {children}
    </label>
  );
}

/** Control segmentado: pocas opciones excluyentes, una al lado de la otra. */
export function Segmented({
  name,
  legend,
  options,
  defaultValue,
  hint,
}: {
  name: string;
  legend: string;
  options: readonly (readonly [value: string, label: string])[];
  defaultValue: string;
  hint?: string;
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium text-slate-800">{legend}</legend>
      <div className="flex w-full rounded-lg bg-slate-100 p-1 sm:inline-flex sm:w-auto">
        {options.map(([value, label]) => (
          <label key={value} className="relative flex-1 cursor-pointer sm:flex-none">
            <input type="radio" name={name} value={value} defaultChecked={value === defaultValue} className="peer sr-only" />
            <span className="block min-h-8 rounded-md px-3.5 py-1.5 text-center text-sm font-medium text-slate-600 transition-[color,background-color,box-shadow] duration-150 hover:text-slate-900 peer-checked:bg-white peer-checked:text-brand-700 peer-checked:shadow-sm peer-focus-visible:outline-2 peer-focus-visible:outline-brand-600">
              {label}
            </span>
          </label>
        ))}
      </div>
      {hint && <p className="text-xs text-slate-600">{hint}</p>}
    </fieldset>
  );
}

/** Selector de hora en punto (00:00 a 23:00, o hasta 24:00). Manda el número de la hora, igual que antes. */
export function HourSelect({ min = 0, max = 23, className = "", ...props }: ComponentProps<"select"> & { min?: number; max?: number }) {
  return (
    <select className={className} {...props}>
      {Array.from({ length: max - min + 1 }, (_, i) => min + i).map((h) => (
        <option key={h} value={h}>
          {`${String(h).padStart(2, "0")}:00`}
        </option>
      ))}
    </select>
  );
}

/** Tarjeta de configuración: encabezado con ícono, cuerpo y (opcional) pie con las acciones. */
export function Panel({
  icon,
  title,
  description,
  aside,
  children,
  className = "",
  ...props
}: Omit<ComponentProps<"section">, "title"> & { icon?: ReactNode; title?: ReactNode; description?: ReactNode; aside?: ReactNode }) {
  return (
    <Card className={`animate-rise ${className}`}>
      <section {...props}>
        {title && (
          <header className={`flex gap-3 px-5 py-4 ${description ? "items-start" : "items-center"} ${children ? "border-b border-slate-100" : ""}`}>
            {icon && <span className={`${iconTile} bg-brand-50 text-brand-700`}>{icon}</span>}
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-slate-900">{title}</h2>
              {description && <p className="mt-0.5 text-sm text-slate-600">{description}</p>}
            </div>
            {aside && <div className="flex shrink-0 items-center gap-2">{aside}</div>}
          </header>
        )}
        {children}
      </section>
    </Card>
  );
}

export function PanelBody({ className = "", ...props }: ComponentProps<"div">) {
  return <div className={`space-y-5 p-5 ${className}`} {...props} />;
}

/** Pie de una tarjeta con el botón de guardar a la derecha y, a la izquierda, una nota o el resultado. */
export function PanelFooter({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3 rounded-b-xl border-t border-slate-100 bg-slate-50/80 px-5 py-3">
      {note && <div className="mr-auto min-w-0 text-xs text-slate-600">{note}</div>}
      {children}
    </div>
  );
}

/** Título de un grupo de campos dentro de una tarjeta. */
export function FieldGroup({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-slate-600">{description}</p>}
      </div>
      {children}
    </div>
  );
}

const calloutTones = {
  info: { box: "bg-brand-50/60 ring-brand-100", icon: "text-brand-600", Icon: Info },
  neutral: { box: "bg-slate-50 ring-slate-200", icon: "text-slate-500", Icon: Info },
  warning: { box: "bg-amber-50 ring-amber-200", icon: "text-amber-600", Icon: TriangleAlert },
  danger: { box: "bg-rose-50 ring-rose-200", icon: "text-rose-600", Icon: TriangleAlert },
};

/** Nota destacada para explicaciones que antes eran párrafos sueltos. */
export function Callout({ tone = "info", title, children, className = "" }: { tone?: keyof typeof calloutTones; title?: ReactNode; children: ReactNode; className?: string }) {
  const t = calloutTones[tone];
  return (
    <div className={`flex gap-2.5 rounded-lg p-3 text-sm text-slate-700 ring-1 ring-inset ${t.box} ${className}`}>
      <t.Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${t.icon}`} />
      <div className="min-w-0 space-y-1">
        {title && <p className="font-semibold text-slate-900">{title}</p>}
        <div className="text-[13px] leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

/** Estado encendido/apagado con un punto que late cuando está activo. */
export function StatusPill({ on, onLabel = "Activo", offLabel = "Apagado", tone = "success" }: { on: boolean; onLabel?: string; offLabel?: string; tone?: "success" | "danger" }) {
  const live = tone === "success" ? "bg-emerald-500" : "bg-rose-500";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${
        on ? (tone === "success" ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-rose-50 text-rose-800 ring-rose-200") : "bg-slate-100 text-slate-600 ring-slate-200"
      }`}
    >
      <span className="relative flex size-2">
        {on && <span aria-hidden className={`absolute inset-0 animate-ping rounded-full opacity-60 motion-reduce:hidden ${live}`} />}
        <span className={`relative size-2 rounded-full ${on ? live : "bg-slate-400"}`} />
      </span>
      {on ? onLabel : offLabel}
    </span>
  );
}

/** Cifra destacada (cantidad, monto) con su etiqueta. */
export function Stat({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-600 [&_svg]:size-4 [&_svg]:text-brand-600">
        {icon}
        {label}
      </div>
      <p className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900 tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/**
 * Elemento desplegable de una lista (regla, documento, variante): se ve el resumen y al abrirlo aparece
 * el formulario para editarlo. Usa <details>, así que no necesita JavaScript.
 */
export function Disclosure({
  summary,
  icon,
  aside,
  children,
  defaultOpen,
  muted,
}: {
  summary: ReactNode;
  icon?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  muted?: boolean;
}) {
  return (
    <details open={defaultOpen} className="group/d rounded-xl border border-slate-200 bg-white shadow-xs transition-shadow duration-150 open:shadow-sm">
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl p-4 transition-colors duration-150 hover:bg-slate-50 group-open/d:rounded-b-none [&::-webkit-details-marker]:hidden">
        {icon && <span className={`${iconTile} bg-brand-50 text-brand-700 ${muted ? "grayscale" : ""}`}>{icon}</span>}
        <div className={`min-w-0 flex-1 ${muted ? "opacity-60" : ""}`}>{summary}</div>
        {aside}
        <ChevronDown aria-hidden className="size-5 shrink-0 text-slate-400 transition-transform duration-200 group-open/d:rotate-180" />
      </summary>
      <div className="animate-fade-in border-t border-slate-100 p-4">{children}</div>
    </details>
  );
}

/** Lista de variables de entorno con su estado (configurada o falta) y para qué sirven. */
export function EnvChecklist({ items }: { items: readonly (readonly [key: string, ok: boolean, help: ReactNode])[] }) {
  return (
    <ul className="grid gap-2">
      {items.map(([key, ok, help]) => (
        <li
          key={key}
          className={`flex gap-3 rounded-lg border p-3 text-sm ${ok ? "border-emerald-200 bg-emerald-50/50" : "border-dashed border-slate-300 bg-white"}`}
        >
          {ok ? (
            <CircleCheck aria-label="Configurada" className="mt-0.5 size-4 shrink-0 text-emerald-600" />
          ) : (
            <CircleDashed aria-label="Falta" className="mt-0.5 size-4 shrink-0 text-slate-400" />
          )}
          <span className="min-w-0">
            <code className="font-mono text-[13px] font-semibold text-slate-900">{key}</code>
            <span className="block text-xs text-slate-600">{help}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Barra de guardar que queda pegada abajo mientras se recorre un formulario largo de varias tarjetas. */
export function SaveBar({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-end gap-3 rounded-xl border border-slate-200 bg-white/90 px-4 py-3 shadow-lg shadow-slate-900/5 backdrop-blur-md">
      {note && <div className="mr-auto min-w-0 text-sm text-slate-600">{note}</div>}
      {children}
    </div>
  );
}

/** Interruptor con su texto al lado, para filas compactas. */
export function InlineSwitch({ label, className = "", ...input }: Omit<ComponentProps<"input">, "type"> & { label: ReactNode }) {
  return (
    <label className={`inline-flex min-h-10 cursor-pointer select-none items-center gap-2.5 text-sm font-medium text-slate-700 ${className}`}>
      <Switch {...input} />
      {label}
    </label>
  );
}

/** Selector de color redondo, sin el marco gris del control nativo. */
export const colorInputClass =
  "size-9 shrink-0 cursor-pointer appearance-none rounded-full border-0 bg-transparent p-0 shadow-sm ring-2 ring-white outline-1 outline-slate-200 transition-[scale] duration-150 hover:scale-110 [&::-moz-color-swatch]:rounded-full [&::-moz-color-swatch]:border-none [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch-wrapper]:p-0";

/** Botones para subir o bajar un elemento de una lista ordenada (cada uno es un formulario aparte). */
export const reorderButtonClass =
  "flex h-6 w-7 items-center justify-center rounded-md text-slate-400 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-30";

/**
 * Interruptor que envía su formulario al tocarlo (activar o pausar una regla, un webhook…).
 * Va dentro de un <form> cuya acción ya sabe el nuevo estado.
 */
export function SwitchSubmit({ on, label }: { on: boolean; label: string }) {
  return (
    <button
      type="submit"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      className={`group relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${on ? "bg-brand-600 hover:bg-brand-700" : "bg-slate-300 hover:bg-slate-400"}`}
    >
      <span
        aria-hidden
        className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow-sm ring-1 ring-black/5 transition-[translate] duration-200 ease-[var(--ease-spring)] ${on ? "translate-x-5" : ""}`}
      />
    </button>
  );
}

/** Lista de envíos (a Meta o a un webhook) con su estado. */
export function EventList({
  rows,
}: {
  rows: { id: string; leadId: string; name: string; what: string; status: { label: string; tone: "success" | "danger" | "warning" | "neutral" }; at: string; error: string | null }[];
}) {
  const dot = { success: "bg-emerald-500", danger: "bg-rose-500", warning: "bg-amber-500", neutral: "bg-slate-400" };
  return (
    <ul className="divide-y divide-slate-100 text-sm">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 transition-colors duration-100 hover:bg-slate-50">
          <span aria-hidden className={`size-2 shrink-0 rounded-full ${dot[r.status.tone]}`} />
          <Link href={`/leads/${r.leadId}`} className="font-medium text-slate-900 hover:text-brand-700 hover:underline">
            {r.name}
          </Link>
          <span className="text-slate-600">{r.what}</span>
          <Badge tone={r.status.tone} className="ml-auto">
            {r.status.label}
          </Badge>
          <time className="w-28 text-right text-xs tabular-nums text-slate-500">{r.at}</time>
          {r.error && <p className="w-full pl-5 text-xs text-rose-700">{r.error}</p>}
        </li>
      ))}
    </ul>
  );
}
