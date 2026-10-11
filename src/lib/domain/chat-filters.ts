import type { Channel } from "@prisma/client";
import { parseLocalDateTime, startOfLocalDay } from "../dates";
import type { Attention } from "./attention";

/**
 * Bandeja de chats: todas las conversaciones de leads, con filtros como los de Vambe (fecha,
 * estado, atención, orden, embudo y etapa, canales, ejecutivos y etiquetas). Los filtros viajan
 * en la URL, así que un filtro se puede guardar o compartir como un enlace.
 */

export const CHAT_DATES = ["today", "7d", "30d", "custom"] as const;
export const CHAT_STATUSES = ["open", "won", "lost", "all"] as const;
export const CHAT_SORTS = ["recent", "oldest", "waiting", "score", "newest"] as const;
export const ATTENTIONS = ["waiting", "ai", "human"] as const satisfies readonly Attention[];
const CHANNELS = ["WHATSAPP", "INSTAGRAM", "FACEBOOK", "SIMULATOR"] as const satisfies readonly Channel[];

export type ChatFilters = {
  /** Busca en el nombre, teléfono o correo del contacto. */
  q: string;
  /** Fecha del último mensaje; vacío es cualquier fecha. "custom" usa `from` y `to` (AAAA-MM-DD). */
  date: (typeof CHAT_DATES)[number] | "";
  from: string;
  to: string;
  status: (typeof CHAT_STATUSES)[number];
  attention: Attention[];
  sort: (typeof CHAT_SORTS)[number];
  stages: string[];
  channels: Channel[];
  /** Ids de ejecutivos; "none" son los leads sin asignar. */
  executives: string[];
  tags: string[];
};

export const DEFAULT_CHAT_FILTERS: ChatFilters = {
  q: "",
  date: "",
  from: "",
  to: "",
  status: "open",
  attention: [],
  sort: "recent",
  stages: [],
  channels: [],
  executives: [],
  tags: [],
};

type Params = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
const list = (v: string | string[] | undefined) =>
  [...new Set((Array.isArray(v) ? v : [v ?? ""]).flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean))];
const pick = <T extends string, F extends string>(value: string, allowed: readonly T[], fallback: F): T | F =>
  (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Lee los filtros de los parámetros de la URL; lo que no se reconoce queda en su valor por defecto. */
export function parseChatFilters(params: Params): ChatFilters {
  return {
    q: one(params.q).slice(0, 100),
    date: pick(one(params.fecha), CHAT_DATES, ""),
    from: isDay(one(params.desde)) ? one(params.desde) : "",
    to: isDay(one(params.hasta)) ? one(params.hasta) : "",
    status: pick(one(params.estado), CHAT_STATUSES, "open"),
    attention: list(params.atencion).filter((a): a is Attention => (ATTENTIONS as readonly string[]).includes(a)),
    sort: pick(one(params.orden), CHAT_SORTS, "recent"),
    stages: list(params.etapas),
    channels: list(params.canales).filter((c): c is Channel => (CHANNELS as readonly string[]).includes(c)),
    executives: list(params.ejecutivos),
    tags: list(params.etiquetas),
  };
}

/** Los filtros como parámetros de URL, omitiendo los que están en su valor por defecto. */
export function chatFiltersToParams(f: ChatFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.date) p.set("fecha", f.date);
  if (f.date === "custom" && f.from) p.set("desde", f.from);
  if (f.date === "custom" && f.to) p.set("hasta", f.to);
  if (f.status !== "open") p.set("estado", f.status);
  if (f.attention.length) p.set("atencion", f.attention.join(","));
  if (f.sort !== "recent") p.set("orden", f.sort);
  if (f.stages.length) p.set("etapas", f.stages.join(","));
  if (f.channels.length) p.set("canales", f.channels.join(","));
  if (f.executives.length) p.set("ejecutivos", f.executives.join(","));
  if (f.tags.length) p.set("etiquetas", f.tags.join(","));
  return p;
}

/** Rango [desde, hasta) del filtro de fecha, en hora de Chile. */
export function chatDateRange(f: Pick<ChatFilters, "date" | "from" | "to">, now: Date): { gte?: Date; lt?: Date } {
  switch (f.date) {
    case "today":
      return { gte: startOfLocalDay(now) };
    case "7d":
      return { gte: startOfLocalDay(now, -6) };
    case "30d":
      return { gte: startOfLocalDay(now, -29) };
    case "custom": {
      const from = f.from ? parseLocalDateTime(f.from, "00:00") : null;
      const to = f.to ? parseLocalDateTime(f.to, "00:00") : null;
      return { ...(from && { gte: from }), ...(to && { lt: startOfLocalDay(to, 1) }) };
    }
    default:
      return {};
  }
}

/** Cuántos filtros están activos (la búsqueda no cuenta). */
export function countActiveFilters(f: ChatFilters, isAdmin: boolean) {
  return (
    (f.date ? 1 : 0) +
    (f.status !== "open" ? 1 : 0) +
    f.attention.length +
    (f.sort !== "recent" ? 1 : 0) +
    f.stages.length +
    f.channels.length +
    (isAdmin ? f.executives.length : 0) +
    f.tags.length
  );
}
