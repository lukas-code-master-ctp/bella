import Link from "next/link";
import { Bot, Headset, MessageCircle, MessageCircleWarning } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { startOfLocalDay, TIME_ZONE } from "@/lib/dates";
import { chatFilterOptions, listChats, type ChatItem } from "@/lib/domain/chats";
import { chatFiltersToParams, countActiveFilters, parseChatFilters } from "@/lib/domain/chat-filters";
import { Avatar, Badge, buttonClass, EmptyState } from "@/components/ui";
import { ScoreBadge } from "@/components/score-badge";
import { LateBadge } from "@/components/late-badge";
import { formatDuration } from "@/lib/domain/metrics";
import { LinkPending } from "@/components/link-pending";
import { CHANNEL_OPTIONS } from "./channels";
import { ChatsShell } from "./filters";
import { AutoRefresh } from "@/components/auto-refresh";
import { LeadView } from "../leads/[id]/lead-view";

const PAGE = 100;
const MAX = 1000;

export default async function ChatsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const params = await searchParams;
  const filters = parseChatFilters(params);
  const take = Math.min(MAX, Math.max(PAGE, Number(params.n) || PAGE));
  const now = new Date();
  const [{ total, items }, options] = await Promise.all([listChats(filters, user, { now, take }), chatFilterOptions(user)]);
  const isAdmin = user.role === "ADMIN";
  const more = chatFiltersToParams(filters);
  more.set("n", String(Math.min(MAX, take + PAGE)));
  // El chat abierto vive en la URL (?lead=…): se puede compartir y "atrás" vuelve a la lista.
  const selected = typeof params.lead === "string" ? params.lead : null;
  const listQuery = chatFiltersToParams(filters);
  if (take > PAGE) listQuery.set("n", String(take));
  const hrefFor = (leadId: string) => {
    const q = new URLSearchParams(listQuery);
    q.set("lead", leadId);
    return `/chats?${q}`;
  };
  const listHref = listQuery.size ? `/chats?${listQuery}` : "/chats";

  return (
    <ChatsShell
      filters={filters}
      options={options}
      isAdmin={isAdmin}
      total={total}
      selected={selected}
      detail={selected ? <LeadView id={selected} back={{ href: listHref, label: "Volver a la lista de chats" }} layout="pane" /> : null}
    >
      <AutoRefresh />
      {items.length === 0 ? (
        <EmptyState icon={<MessageCircle />} title={countActiveFilters(filters, isAdmin) || filters.q ? "Ningún chat calza con estos filtros" : "Aún no hay chats"}>
          {countActiveFilters(filters, isAdmin) || filters.q
            ? "Prueba quitando algún filtro o con otra búsqueda."
            : "Las conversaciones aparecen aquí apenas un cliente escribe por WhatsApp, Instagram o Facebook."}
        </EmptyState>
      ) : (
        <>
          <ul className="stagger divide-y divide-slate-100">
            {items.map((c) => (
              <li key={c.leadId}>
                <ChatRow chat={c} now={now} href={hrefFor(c.leadId)} selected={c.leadId === selected} />
              </li>
            ))}
          </ul>
          {total > items.length && (
            <div className="flex flex-col items-center gap-2 border-t border-slate-100 p-4 text-sm text-slate-600">
              <p>
                Mostrando {items.length} de {total.toLocaleString("es-CL")} chats.
              </p>
              {take < MAX ? (
                <Link href={`/chats?${more}`} scroll={false} className={buttonClass("secondary", "sm")}>
                  Ver más chats
                </Link>
              ) : (
                <p>Usa los filtros para encontrar el resto.</p>
              )}
            </div>
          )}
        </>
      )}
    </ChatsShell>
  );
}

const hourFormat = new Intl.DateTimeFormat("es-CL", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dayFormat = new Intl.DateTimeFormat("es-CL", { timeZone: TIME_ZONE, day: "2-digit", month: "2-digit" });
const weekdayFormat = new Intl.DateTimeFormat("es-CL", { timeZone: TIME_ZONE, weekday: "long" });

/** "19:26", "Ayer", "martes" o "08-10", como en WhatsApp. */
function chatTime(at: Date, now: Date) {
  if (at >= startOfLocalDay(now)) return hourFormat.format(at);
  if (at >= startOfLocalDay(now, -1)) return "Ayer";
  if (at >= startOfLocalDay(now, -6)) {
    const day = weekdayFormat.format(at);
    return day.charAt(0).toUpperCase() + day.slice(1);
  }
  return dayFormat.format(at).replace("/", "-");
}

function preview(last: ChatItem["last"]) {
  if (!last) return { prefix: "", text: "Sin mensajes todavía" };
  const text = last.body || (last.media === "audio" ? "🎤 Nota de voz" : last.media === "file" ? "📎 Archivo" : "");
  const prefix = last.author === "AI" ? "IA: " : last.author === "USER" ? "Tú: " : "";
  return { prefix, text };
}

function ChatRow({ chat: c, now, href, selected }: { chat: ChatItem; now: Date; href: string; selected: boolean }) {
  const { prefix, text } = preview(c.last);
  const channel = CHANNEL_OPTIONS.find((o) => o.value === c.channel);
  const waiting = c.attention === "waiting";
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={selected ? "true" : undefined}
      className={`group relative flex gap-3 px-4 py-3.5 transition-colors duration-150 hover:bg-brand-50/50 focus-visible:bg-brand-50 focus-visible:outline-none ${
        selected ? "bg-brand-50 shadow-[inset_3px_0_0_var(--color-brand-600)]" : ""
      }`}
    >
      <span className="relative h-fit shrink-0">
        <Avatar name={c.name} size="lg" />
        {channel && (
          <span
            aria-hidden
            title={channel.label}
            className={`absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full ring-2 ring-white ${channel.dot}`}
          />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={`min-w-0 truncate text-sm ${waiting ? "font-bold text-slate-900" : "font-semibold text-slate-800"}`}>{c.name}</span>
          {waiting && <span aria-hidden className="size-2 shrink-0 rounded-full bg-brand-600" />}
          <span className={`ml-auto shrink-0 text-xs tabular-nums ${waiting ? "font-semibold text-brand-700" : "text-slate-500"}`}>{chatTime(c.at, now)}</span>
        </span>
        <span className={`mt-0.5 block truncate text-sm ${waiting ? "text-slate-800" : "text-slate-600"}`}>
          {prefix && <span className="text-slate-500">{prefix}</span>}
          {text}
        </span>
        <span className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-200">
            <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: c.stage.color }} />
            {c.stage.name}
          </span>
          {c.tags.slice(0, 2).map((t) => (
            <span key={t.name} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
              <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: t.color }} />
              {t.name}
            </span>
          ))}
          {c.tags.length > 2 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">+{c.tags.length - 2}</span>}
          {c.score != null && <ScoreBadge score={c.score} />}
          <span className="ml-auto flex items-center gap-1.5">
            {c.status === "WON" && <Badge tone="success">Ganado</Badge>}
            {c.status === "LOST" && <Badge tone="danger">Perdido</Badge>}
            {c.assignee ? (
              <span title={`Asignado a ${c.assignee}`} className="inline-flex">
                <Avatar name={c.assignee} size="sm" />
                <span className="sr-only">Asignado a {c.assignee}</span>
              </span>
            ) : null}
            {c.lateMs !== null && <LateBadge late={formatDuration(c.lateMs)} />}
            {c.status === "OPEN" && <AttentionBadge attention={c.attention} />}
          </span>
        </span>
      </span>
      <LinkPending />
    </Link>
  );
}

function AttentionBadge({ attention }: { attention: ChatItem["attention"] }) {
  if (attention === "waiting")
    return (
      <Badge tone="danger">
        <MessageCircleWarning aria-hidden />
        Sin atender
      </Badge>
    );
  if (attention === "ai")
    return (
      <Badge tone="brand">
        <Bot aria-hidden />
        IA
      </Badge>
    );
  return (
    <Badge tone="warning">
      <Headset aria-hidden />
      Ejecutivo
    </Badge>
  );
}
