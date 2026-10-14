"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowDownUp,
  CalendarDays,
  ChevronDown,
  Eraser,
  Columns3,
  Search,
  Save,
  SlidersHorizontal,
  Smartphone,
  Star,
  Tags,
  Trash2,
  UserRoundX,
  UsersRound,
  X,
  Binoculars,
} from "lucide-react";
import { chatFiltersToParams, countActiveFilters, DEFAULT_CHAT_FILTERS, parseChatFilters, type ChatFilters } from "@/lib/domain/chat-filters";
import { CHANNEL_OPTIONS } from "./channels";
import type { Attention } from "@/lib/domain/attention";
import { Avatar, inputClass } from "@/components/ui";

export type FilterOptions = {
  funnels: { id: string; name: string; stages: { id: string; name: string; color: string }[] }[];
  executives: { id: string; name: string }[];
  tags: { id: string; name: string; color: string; category: string }[];
};

const DATES: { value: ChatFilters["date"]; label: string }[] = [
  { value: "", label: "Cualquier fecha" },
  { value: "today", label: "Hoy" },
  { value: "7d", label: "Últimos 7 días" },
  { value: "30d", label: "Últimos 30 días" },
  { value: "custom", label: "Elegir fechas" },
];
const STATUSES: { value: ChatFilters["status"]; label: string }[] = [
  { value: "open", label: "Abiertos" },
  { value: "won", label: "Ganados" },
  { value: "lost", label: "Perdidos" },
  { value: "all", label: "Todos" },
];
const ATTENTION: { value: Attention; label: string; hint: string }[] = [
  { value: "waiting", label: "Sin atender", hint: "El cliente escribió y nadie le ha respondido" },
  { value: "ai", label: "Atiende la IA", hint: "La asistente está a cargo" },
  { value: "human", label: "Atiende un ejecutivo", hint: "IA pausada o etapa de atención humana" },
];
const SORTS: { value: ChatFilters["sort"]; label: string }[] = [
  { value: "recent", label: "Último mensaje más reciente" },
  { value: "oldest", label: "Último mensaje más antiguo" },
  { value: "waiting", label: "Sin atender primero" },
  { value: "score", label: "Mayor puntaje" },
  { value: "newest", label: "Leads más nuevos" },
];

const SAVED_KEY = "bella.chats.filtros";
type Saved = { name: string; query: string };

function readSaved(): Saved[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((s) => typeof s?.name === "string" && typeof s?.query === "string") : [];
  } catch {
    return [];
  }
}

function writeSaved(list: Saved[]) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(list));
  } catch {
    // Sin almacenamiento (modo privado): el filtro sigue funcionando, solo no se guarda.
  }
}

const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

/**
 * Bandeja de chats: panel de filtros a la izquierda y la lista a la derecha.
 * Cada cambio actualiza la URL al tiro; la lista la arma el servidor.
 */
export function ChatsShell({
  filters,
  options,
  isAdmin,
  total,
  selected = null,
  detail = null,
  children,
}: {
  filters: ChatFilters;
  options: FilterOptions;
  isAdmin: boolean;
  total: number;
  /** Lead abierto (?lead=…): la lista se angosta, los filtros se pliegan y la conversación ocupa el resto. */
  selected?: string | null;
  detail?: React.ReactNode;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(filters);
  const [mobileOpen, setMobileOpen] = useState(false);
  const key = chatFiltersToParams(filters).toString();
  // Si la URL cambia por otro lado (atrás/adelante, un filtro guardado), el panel la sigue.
  useEffect(() => setDraft(filters), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  function apply(next: ChatFilters) {
    setDraft(next);
    const params = chatFiltersToParams(next);
    if (selected) params.set("lead", selected);
    const query = params.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  }
  const set = (patch: Partial<ChatFilters>) => apply({ ...draft, ...patch });

  // La búsqueda espera a que dejes de escribir.
  const [q, setQ] = useState(filters.q);
  useEffect(() => setQ(filters.q), [filters.q]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  function onSearch(value: string) {
    setQ(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => set({ q: value.trim() }), 350);
  }

  const active = countActiveFilters(draft, isAdmin);

  return (
    <div className={`grid gap-4 lg:items-start ${selected ? "lg:grid-cols-[320px_minmax(0,1fr)]" : "lg:grid-cols-[300px_minmax(0,1fr)]"}`}>
      <div className={`flex items-center gap-2 ${selected ? "max-lg:hidden" : "lg:hidden"}`}>
        <button
          type="button"
          onClick={() => setMobileOpen((o) => !o)}
          aria-expanded={mobileOpen}
          aria-controls="chat-filters"
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-xs hover:bg-slate-50"
        >
          <SlidersHorizontal aria-hidden className="size-4" />
          Filtros
          {active > 0 && <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-[11px] leading-none text-white">{active}</span>}
        </button>
        {active > 0 && (
          <button type="button" onClick={() => apply({ ...DEFAULT_CHAT_FILTERS, q: draft.q })} className="text-sm font-semibold text-brand-700 hover:underline">
            Limpiar
          </button>
        )}
      </div>

      <aside
        id="chat-filters"
        aria-label="Filtros"
        className={`${mobileOpen ? "block animate-fade-in" : "hidden"} overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm ${
          selected ? "max-lg:hidden lg:col-start-1" : "lg:sticky lg:top-6 lg:block lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto"
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
            Filtros
            {active > 0 && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">{active} activos</span>}
          </h2>
          <button
            type="button"
            onClick={() => apply({ ...DEFAULT_CHAT_FILTERS, q: draft.q })}
            disabled={active === 0}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50 disabled:pointer-events-none disabled:text-slate-400"
          >
            <Eraser aria-hidden className="size-4" />
            Limpiar
          </button>
        </div>

        <SavedFilters current={draft} onPick={(query) => apply(parseChatFilters(Object.fromEntries(new URLSearchParams(query))))} />

        <Section icon={<CalendarDays />} title="Fecha" count={draft.date ? 1 : 0}>
          <p className="mb-2 text-xs text-slate-500">Del último mensaje de la conversación.</p>
          <div className="flex flex-wrap gap-1.5">
            {DATES.map((d) => (
              <Chip key={d.value} selected={draft.date === d.value} onClick={() => set({ date: d.value })}>
                {d.label}
              </Chip>
            ))}
          </div>
          {draft.date === "custom" && (
            <div className="mt-3 grid grid-cols-2 gap-2 animate-fade-in">
              <label className="space-y-1 text-xs font-medium text-slate-600">
                Desde
                <input type="date" value={draft.from} max={draft.to || undefined} onChange={(e) => set({ from: e.target.value })} className={inputClass} />
              </label>
              <label className="space-y-1 text-xs font-medium text-slate-600">
                Hasta
                <input type="date" value={draft.to} min={draft.from || undefined} onChange={(e) => set({ to: e.target.value })} className={inputClass} />
              </label>
            </div>
          )}
        </Section>

        <Section icon={<Binoculars />} title="Principal" count={(draft.status !== "open" ? 1 : 0) + draft.attention.length} defaultOpen>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Estado del lead</p>
          <div className="grid grid-cols-4 gap-1 rounded-lg bg-slate-100 p-1">
            {STATUSES.map((s) => (
              <button
                key={s.value}
                type="button"
                aria-pressed={draft.status === s.value}
                onClick={() => set({ status: s.value })}
                className={`min-h-8 rounded-md px-1 text-xs font-semibold transition-colors ${
                  draft.status === s.value ? "bg-white text-brand-700 shadow-xs" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Quién atiende</p>
          {ATTENTION.map((a) => (
            <Check key={a.value} checked={draft.attention.includes(a.value)} onChange={() => set({ attention: toggle(draft.attention, a.value) })} hint={a.hint}>
              <AttentionDot attention={a.value} />
              {a.label}
            </Check>
          ))}
        </Section>

        <Section icon={<ArrowDownUp />} title="Orden" count={draft.sort !== "recent" ? 1 : 0}>
          <div role="radiogroup" aria-label="Orden" className="space-y-0.5">
            {SORTS.map((s) => (
              <label key={s.value} className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-2 text-sm text-slate-700 hover:bg-slate-50">
                <input type="radio" name="orden" checked={draft.sort === s.value} onChange={() => set({ sort: s.value })} className="size-4 accent-brand-600" />
                {s.label}
              </label>
            ))}
          </div>
        </Section>

        <Section icon={<Columns3 />} title="Embudo y etapa" count={draft.stages.length} defaultOpen={draft.stages.length > 0}>
          <StagePicker funnels={options.funnels} selected={draft.stages} onChange={(stages) => set({ stages })} />
        </Section>

        <Section icon={<Smartphone />} title="Canales" count={draft.channels.length}>
          {CHANNEL_OPTIONS.map((c) => (
            <Check key={c.value} checked={draft.channels.includes(c.value)} onChange={() => set({ channels: toggle(draft.channels, c.value) })}>
              <span aria-hidden className={`size-2.5 rounded-full ${c.dot}`} />
              {c.label}
            </Check>
          ))}
        </Section>

        {isAdmin && (
          <Section icon={<UsersRound />} title="Ejecutivos" count={draft.executives.length} defaultOpen={draft.executives.length > 0}>
            <SearchableList
              placeholder="Buscar ejecutivos"
              items={[{ id: "none", name: "Sin asignar" }, ...options.executives]}
              selected={draft.executives}
              onToggle={(id) => set({ executives: toggle(draft.executives, id) })}
              render={(e) =>
                e.id === "none" ? (
                  <>
                    <span aria-hidden className="flex size-6 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                      <UserRoundX className="size-3.5" />
                    </span>
                    Sin asignar
                  </>
                ) : (
                  <>
                    <Avatar name={e.name} size="sm" />
                    {e.name}
                  </>
                )
              }
            />
          </Section>
        )}

        <Section icon={<Tags />} title="Etiquetas" count={draft.tags.length} defaultOpen={draft.tags.length > 0} last>
          {options.tags.length === 0 ? (
            <p className="text-sm text-slate-500">Aún no hay etiquetas.</p>
          ) : (
            <SearchableList
              placeholder="Buscar etiquetas"
              items={options.tags.map((t) => ({ ...t, search: `${t.category} ${t.name}` }))}
              selected={draft.tags}
              onToggle={(id) => set({ tags: toggle(draft.tags, id) })}
              render={(t) => (
                <>
                  <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
                  <span className="min-w-0 truncate">
                    {t.name} <span className="text-xs text-slate-500">· {t.category}</span>
                  </span>
                </>
              )}
            />
          )}
        </Section>
      </aside>

      <section
        aria-label="Conversaciones"
        className={`min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm ${
          selected ? "max-lg:hidden lg:col-start-1 lg:flex lg:h-[calc(100dvh-13.5rem)] lg:flex-col lg:overflow-hidden" : ""
        }`}
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-3">
          <div className="relative min-w-0 flex-1">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <label htmlFor="chat-search" className="sr-only">
              Buscar por nombre, teléfono o correo
            </label>
            <input
              id="chat-search"
              type="search"
              value={q}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Buscar por nombre, teléfono o correo"
              className={`${inputClass} pl-9`}
            />
          </div>
          <p className="text-sm tabular-nums text-slate-600" aria-live="polite">
            {total === 1 ? "1 chat" : `${total.toLocaleString("es-CL")} chats`}
          </p>
        </div>
        <div
          aria-busy={pending}
          className={`transition-opacity duration-200 ${pending ? "opacity-60" : ""} ${selected ? "lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain" : ""}`}
        >
          {children}
        </div>
      </section>
      {detail && <div className="min-w-0 lg:col-start-2 lg:row-start-1 lg:row-span-3">{detail}</div>}
    </div>
  );
}


function Section({
  icon,
  title,
  count,
  defaultOpen = false,
  last = false,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  defaultOpen?: boolean;
  last?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = `filtro-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <div className={last ? "" : "border-b border-slate-200"}>
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-12 w-full items-center gap-3 px-4 text-left text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50 [&>svg:first-child]:size-[18px] [&>svg:first-child]:text-brand-600"
        >
          {icon}
          <span className="flex-1">{title}</span>
          {count > 0 && (
            <span key={count} className="animate-pop rounded-full bg-brand-600 px-1.5 py-0.5 text-[11px] leading-none tabular-nums text-white">
              {count}
            </span>
          )}
          <ChevronDown aria-hidden className={`size-4 text-slate-500 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </button>
      </h3>
      {open && (
        <div id={id} className="animate-fade-in px-4 pb-4">
          {children}
        </div>
      )}
    </div>
  );
}

function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`min-h-8 rounded-full px-3 text-xs font-semibold ring-1 ring-inset transition-colors ${
        selected ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50 hover:ring-slate-400"
      }`}
    >
      {children}
    </button>
  );
}

function Check({
  checked,
  indeterminate = false,
  onChange,
  hint,
  children,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  hint?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <label title={hint} className="flex min-h-9 min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-md px-2 text-sm text-slate-700 hover:bg-slate-50">
      <input ref={ref} type="checkbox" checked={checked} onChange={onChange} className="size-4 shrink-0 rounded accent-brand-600" />
      <span className="flex min-w-0 items-center gap-2">{children}</span>
    </label>
  );
}

function AttentionDot({ attention }: { attention: Attention }) {
  const cls = { waiting: "bg-rose-500", ai: "bg-brand-500", human: "bg-amber-500" }[attention];
  return <span aria-hidden className={`size-2.5 rounded-full ${cls}`} />;
}

function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative mb-2">
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
      <input type="search" aria-label={placeholder} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={`${inputClass} pl-9`} />
    </div>
  );
}

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

function SearchableList<T extends { id: string; name: string; search?: string }>({
  items,
  selected,
  onToggle,
  render,
  placeholder,
}: {
  items: T[];
  selected: string[];
  onToggle: (id: string) => void;
  render: (item: T) => React.ReactNode;
  placeholder: string;
}) {
  const [q, setQ] = useState("");
  const shown = q ? items.filter((i) => norm(i.search ?? i.name).includes(norm(q))) : items;
  return (
    <>
      {items.length > 6 && <SearchInput value={q} onChange={setQ} placeholder={placeholder} />}
      <div className="max-h-72 space-y-0.5 overflow-y-auto">
        {shown.map((item) => (
          <Check key={item.id} checked={selected.includes(item.id)} onChange={() => onToggle(item.id)}>
            {render(item)}
          </Check>
        ))}
        {shown.length === 0 && <p className="px-2 py-1 text-sm text-slate-500">Sin resultados.</p>}
      </div>
    </>
  );
}

function StagePicker({
  funnels,
  selected,
  onChange,
}: {
  funnels: FilterOptions["funnels"];
  selected: string[];
  onChange: (stages: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<string[]>(() =>
    funnels.length === 1 ? funnels.map((f) => f.id) : funnels.filter((f) => f.stages.some((s) => selected.includes(s.id))).map((f) => f.id),
  );
  const total = funnels.reduce((n, f) => n + f.stages.length, 0);
  if (total === 0) return <p className="text-sm text-slate-500">Aún no hay etapas.</p>;
  return (
    <>
      {total > 6 && <SearchInput value={q} onChange={setQ} placeholder="Buscar etapas" />}
      <div className="space-y-1">
        {funnels.map((f) => {
          const stages = q ? f.stages.filter((s) => norm(s.name).includes(norm(q))) : f.stages;
          if (q && stages.length === 0) return null;
          const ids = f.stages.map((s) => s.id);
          const picked = ids.filter((id) => selected.includes(id)).length;
          const open = Boolean(q) || expanded.includes(f.id);
          return (
            <div key={f.id}>
              <div className="flex items-center">
                <Check
                  checked={picked > 0 && picked === ids.length}
                  indeterminate={picked > 0 && picked < ids.length}
                  onChange={() => onChange(picked === ids.length ? selected.filter((id) => !ids.includes(id)) : [...new Set([...selected, ...ids])])}
                >
                  <span className="truncate font-medium text-slate-800">{f.name}</span>
                </Check>
                <button
                  type="button"
                  aria-label={open ? `Ocultar etapas de ${f.name}` : `Ver etapas de ${f.name}`}
                  aria-expanded={open}
                  onClick={() => setExpanded((e) => toggle(e, f.id))}
                  className="flex size-9 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
                >
                  <ChevronDown aria-hidden className={`size-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
                </button>
              </div>
              {open && (
                <div className="ml-4 animate-fade-in border-l border-slate-200 pl-2">
                  {stages.map((s) => (
                    <Check key={s.id} checked={selected.includes(s.id)} onChange={() => onChange(toggle(selected, s.id))}>
                      <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                      <span className="truncate">{s.name}</span>
                    </Check>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/** Filtros guardados en este navegador: un nombre y la combinación de filtros. */
function SavedFilters({ current, onPick }: { current: ChatFilters; onPick: (query: string) => void }) {
  const [saved, setSaved] = useState<Saved[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  useEffect(() => setSaved(readSaved()), []);
  const query = useMemo(() => {
    const p = chatFiltersToParams(current);
    p.delete("q");
    return p.toString();
  }, [current]);
  const match = saved.find((s) => s.query === query);

  function save() {
    const n = name.trim();
    if (!n) return;
    const next = [...saved.filter((s) => s.name !== n), { name: n, query }];
    setSaved(next);
    writeSaved(next);
    setNaming(false);
    setName("");
  }
  function remove() {
    if (!match) return;
    const next = saved.filter((s) => s !== match);
    setSaved(next);
    writeSaved(next);
  }

  return (
    <div className="border-b border-slate-200 px-4 py-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Filtros guardados</p>
      {naming ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="flex gap-2 animate-fade-in"
        >
          <input autoFocus aria-label="Nombre del filtro" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Sin atender de hoy" maxLength={40} className={inputClass} />
          <button type="submit" disabled={!name.trim()} className="min-h-10 shrink-0 rounded-lg bg-brand-600 px-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
            Guardar
          </button>
          <button type="button" aria-label="Cancelar" onClick={() => setNaming(false)} className="flex size-10 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">
            <X aria-hidden className="size-4" />
          </button>
        </form>
      ) : (
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Star aria-hidden className={`pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 ${match ? "fill-brand-500 text-brand-500" : "text-slate-400"}`} />
            <select
              aria-label="Filtro guardado"
              value={match?.name ?? ""}
              onChange={(e) => {
                const s = saved.find((x) => x.name === e.target.value);
                if (s) onPick(s.query);
              }}
              className={`${inputClass} pl-9`}
            >
              <option value="" disabled>
                {saved.length ? "Selecciona un filtro" : "Aún no guardas filtros"}
              </option>
              {saved.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          {match ? (
            <button type="button" title="Borrar este filtro guardado" aria-label="Borrar este filtro guardado" onClick={remove} className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-slate-300 text-slate-500 hover:bg-rose-50 hover:text-rose-700">
              <Trash2 aria-hidden className="size-4" />
            </button>
          ) : (
            <button
              type="button"
              title="Guardar los filtros actuales"
              aria-label="Guardar los filtros actuales"
              disabled={!query}
              onClick={() => setNaming(true)}
              className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-slate-300 text-slate-500 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-40"
            >
              <Save aria-hidden className="size-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
