"use client";

import Link from "next/link";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { Bot, CalendarClock, ChevronLeft, ChevronRight, Headset, Megaphone, MessageCircleWarning, Sparkles, UserRound } from "lucide-react";
import type { Channel } from "@prisma/client";
import type { Attention } from "@/lib/domain/attention";
import type { TaskBucket } from "@/lib/domain/tasks";
import { Avatar, Badge, TagPill } from "@/components/ui";
import { LinkPending } from "@/components/link-pending";
import { ScoreBadge } from "@/components/score-badge";
import { LateBadge } from "@/components/late-badge";
import { moveLeadAction } from "./actions";

export type BoardLead = {
  id: string;
  stageId: string;
  name: string;
  channel: string;
  channelKey: Channel;
  assignee: string | null;
  aiEnabled: boolean;
  /** Quién lo atiende ahora (ver src/lib/domain/attention.ts). */
  attention: Attention;
  /** Si está sin atender, hace cuánto escribió el cliente ("hace 5 min"). */
  waitingFor: string | null;
  /** Si pasó la meta de respuesta del equipo (SLA), cuánto lleva esperando ("1 h 5 min"). */
  late: string | null;
  lastMessage: string | null;
  /** Resumen de una línea hecho por la IA; si aún no hay, se muestra el último mensaje. */
  summary: string | null;
  score: number | null;
  scoreReason: string | null;
  /** La tarea pendiente que vence primero, con su plazo en palabras ("Venció hace 2 h", "Hoy 15:30"). */
  nextTask: { title: string; due: string; bucket: TaskBucket } | null;
  tags: { label: string; color: string }[];
  /** Campaña o anuncio por el que llegó (ver campaignOf); null si llegó directo. */
  origin: string | null;
  updatedAt: string;
};

/** `hidden`: leads abiertos de la etapa que no se cargaron en el tablero. */
export type BoardStage = { id: string; name: string; color: string; requiresHuman: boolean; hidden: number };

/** `leadHref`: enlace al panel del lead, con "__id__" en lugar del id (conserva los filtros de la URL). */
export function Board({ stages, leads, leadHref }: { stages: BoardStage[]; leads: BoardLead[]; leadHref: string }) {
  const [optimistic, move] = useOptimistic(leads, (state, { id, stageId }: { id: string; stageId: string }) =>
    state.map((l) => (l.id === id ? { ...l, stageId } : l)),
  );
  const [, startTransition] = useTransition();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  // En el teléfono el tablero es una lista por etapa: se elige la etapa en una tira de pestañas.
  const [mobileStage, setMobileStage] = useState(() => (stages.find((s) => leads.some((l) => l.stageId === s.id)) ?? stages[0])?.id);
  const nav = useBoardNav(stages.length);

  function onDrop(event: React.DragEvent, stageId: string) {
    event.preventDefault();
    setOver(null);
    const id = event.dataTransfer.getData("text/plain");
    const lead = optimistic.find((l) => l.id === id);
    if (!lead || lead.stageId === stageId) return;
    startTransition(async () => {
      move({ id, stageId });
      await moveLeadAction(id, stageId);
    });
  }

  return (
    <>
      <div role="tablist" aria-label="Etapas" className="-mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:hidden">
        {stages.map((stage) => {
          const total = optimistic.filter((l) => l.stageId === stage.id).length + stage.hidden;
          const active = stage.id === mobileStage;
          return (
            <button
              key={stage.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setMobileStage(stage.id)}
              className={`flex min-h-10 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-colors duration-150 ${
                active ? "border-brand-600 bg-brand-50 text-brand-800" : "border-slate-200 bg-white text-slate-700"
              }`}
            >
              <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: stage.color }} />
              {stage.name}
              <span className="tabular-nums text-slate-500">{total}</span>
            </button>
          );
        })}
      </div>
      <nav aria-label="Ir a una etapa" className="mb-3 flex items-center gap-1.5 max-md:hidden">
        <button
          type="button"
          onClick={() => nav.step(-1)}
          disabled={nav.atStart}
          aria-label="Etapas anteriores"
          className="flex size-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 transition-colors duration-150 hover:border-slate-300 hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4"
        >
          <ChevronLeft aria-hidden />
        </button>
        <div ref={nav.stripRef} className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none]">
          {stages.map((stage, i) => {
            const total = optimistic.filter((l) => l.stageId === stage.id).length + stage.hidden;
            const visible = nav.visible.has(i);
            return (
              <button
                key={stage.id}
                type="button"
                onClick={() => nav.goTo(i)}
                aria-current={visible ? "true" : undefined}
                className={`flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors duration-150 ${
                  visible ? "border-brand-300 bg-brand-50 text-brand-800" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900"
                }`}
              >
                <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: stage.color }} />
                {stage.name}
                <span className="tabular-nums text-slate-500">{total}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => nav.step(1)}
          disabled={nav.atEnd}
          aria-label="Etapas siguientes"
          className="flex size-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 transition-colors duration-150 hover:border-slate-300 hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4"
        >
          <ChevronRight aria-hidden />
        </button>
      </nav>
      <div
        ref={nav.boardRef}
        style={nav.height ? { height: nav.height } : undefined}
        onPointerDown={nav.startPan}
        className={`-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-3 max-md:mx-0 max-md:block max-md:px-0 sm:mx-0 sm:px-0 ${nav.panning ? "cursor-grabbing select-none md:snap-none" : ""}`}
      >
        {stages.map((stage) => {
          const items = optimistic.filter((l) => l.stageId === stage.id);
          const total = items.length + stage.hidden;
          const isOver = over === stage.id && dragging !== null;
          return (
            <section
              key={stage.id}
              aria-label={`${stage.name}: ${total} leads`}
              onDragOver={(e) => {
                e.preventDefault();
                if (over !== stage.id) setOver(stage.id);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
              }}
              onDrop={(e) => onDrop(e, stage.id)}
              className={`flex w-[288px] shrink-0 snap-start flex-col rounded-xl border md:min-h-0 max-md:w-full ${stage.id === mobileStage ? "" : "max-md:hidden"} transition-[background-color,border-color,box-shadow] duration-200 ${
                isOver ? "border-brand-300 bg-brand-50 shadow-[0_0_0_4px_var(--color-brand-100)]" : "border-transparent bg-slate-100"
              }`}
            >
              <header className="flex items-center gap-2 px-3 pb-2 pt-3 max-md:hidden">
                <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: stage.color }} />
                <h2 className="truncate text-sm font-semibold text-slate-900">{stage.name}</h2>
                {stage.requiresHuman && (
                  <Badge tone="warning">
                    <UserRound aria-hidden />
                    Humano
                  </Badge>
                )}
                <span key={total} className="ml-auto animate-pop rounded-full bg-white px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-700 ring-1 ring-inset ring-slate-200">
                  {total}
                </span>
              </header>
              <div className="stagger flex min-h-28 flex-1 flex-col gap-2 p-2 pt-1 max-md:pt-2 md:overflow-y-auto md:overscroll-contain">
                {items.length === 0 && (
                  <p className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500">
                    {isOver ? "Suelta aquí" : "Sin leads"}
                  </p>
                )}
                {items.map((lead) => (
                  <Link
                    key={lead.id}
                    href={leadHref.replace("__id__", encodeURIComponent(lead.id))}
                    scroll={false}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", lead.id);
                      setDragging(lead.id);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                    className={`group relative block shrink-0 cursor-grab overflow-hidden rounded-lg border bg-white p-3 shadow-xs transition-[border-color,box-shadow,opacity,translate,scale] duration-200 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md active:cursor-grabbing ${
                      lead.late ? "border-rose-200 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-rose-500" : lead.attention === "waiting" ? "border-amber-200 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-amber-400" : "border-slate-200"
                    } ${dragging === lead.id ? "scale-[0.97] opacity-50" : ""}`}
                  >
                    <div className="flex items-start gap-2">
                      <ChannelAvatar name={lead.name} channel={lead.channelKey} label={lead.channel} />
                      <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
                        <span className="w-full truncate font-semibold leading-snug text-slate-900 group-hover:text-brand-700" title={lead.name}>
                          {lead.name}
                        </span>
                        <span className="flex w-full min-w-0 flex-wrap gap-1">
                          <AttentionBadge attention={lead.attention} waitingFor={lead.waitingFor} />
                          {lead.late && <LateBadge late={lead.late} />}
                        </span>
                      </div>
                    </div>
                    {lead.summary ? (
                      <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-slate-700">
                        <Sparkles aria-label="Resumen IA:" className="mr-1 inline size-3 -translate-y-px text-brand-500" />
                        {lead.summary}
                      </p>
                    ) : (
                      lead.lastMessage && <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-slate-600">{lead.lastMessage}</p>
                    )}
                    {lead.nextTask && <TaskDue task={lead.nextTask} />}
                    {lead.tags.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-1">
                        {lead.tags.map((t) => (
                          <TagPill key={t.label} {...t} />
                        ))}
                      </div>
                    )}
                    <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-2.5 text-xs text-slate-600">
                      {lead.assignee ? <Avatar name={lead.assignee} size="sm" /> : <UserRound aria-hidden className="size-4 text-slate-400" />}
                      <span className="truncate">{lead.assignee ?? "Sin asignar"}</span>
                      <span className="ml-auto flex min-w-0 items-center gap-2">
                        {lead.origin && (
                          <span
                            title={`Llegó por: ${lead.origin}`}
                            className="inline-flex min-w-0 items-center gap-1 rounded-full bg-sky-50 px-1.5 py-0.5 text-[11px] font-medium text-sky-800"
                          >
                            <Megaphone aria-label="Campaña:" className="size-3 shrink-0" />
                            <span className="max-w-[7rem] truncate">{lead.origin}</span>
                          </span>
                        )}
                        {lead.score !== null && <ScoreBadge score={lead.score} reason={lead.scoreReason} />}
                      </span>
                    </div>
                    <LinkPending />
                  </Link>
                ))}
                {stage.hidden > 0 && (
                  <p className="px-1 py-2 text-center text-xs text-slate-500">
                    y {stage.hidden} más; búscalos en{" "}
                    <Link href="/chats" className="font-medium text-brand-700 underline-offset-2 hover:underline">
                      Chats
                    </Link>
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

/** Espacio que se deja bajo el tablero: el margen inferior de la página (bajo lg también la barra de navegación fija). */
const bottomGap = () => (window.innerWidth >= 1024 ? 32 : 88);

/**
 * Navegación lateral del tablero en escritorio: el tablero ocupa el alto de la pantalla (cada columna se desplaza por
 * dentro, así la barra horizontal queda a la vista), la tira de etapas lleva a una columna, las flechas avanzan de a
 * una pantalla y se puede arrastrar el fondo para moverse de lado.
 */
function useBoardNav(count: number) {
  const boardRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [visible, setVisible] = useState<Set<number>>(new Set());
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);
  const [panning, setPanning] = useState(false);

  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const wide = window.matchMedia("(min-width: 768px)");
    function measure() {
      if (!board || !wide.matches) return setHeight(null);
      const top = board.getBoundingClientRect().top + window.scrollY;
      setHeight(Math.max(360, Math.round(window.innerHeight - top - bottomGap())));
    }
    function edges() {
      if (!board) return;
      setAtStart(board.scrollLeft <= 1);
      setAtEnd(board.scrollLeft + board.clientWidth >= board.scrollWidth - 1);
    }
    measure();
    edges();
    const resize = new ResizeObserver(() => {
      measure();
      edges();
    });
    if (board.parentElement) resize.observe(board.parentElement);
    resize.observe(board);
    window.addEventListener("resize", measure);
    wide.addEventListener("change", measure);
    board.addEventListener("scroll", edges, { passive: true });
    const seen = new IntersectionObserver(
      (entries) =>
        setVisible((prev) => {
          const next = new Set(prev);
          for (const e of entries) {
            const i = Array.prototype.indexOf.call(board.children, e.target);
            if (e.isIntersecting) next.add(i);
            else next.delete(i);
          }
          return next;
        }),
      { root: board, threshold: 0.6 },
    );
    for (const col of Array.from(board.children)) seen.observe(col);
    return () => {
      resize.disconnect();
      seen.disconnect();
      window.removeEventListener("resize", measure);
      wide.removeEventListener("change", measure);
      board.removeEventListener("scroll", edges);
    };
  }, [count]);

  // La etapa visible más a la izquierda se mantiene a la vista en la tira.
  const first = Math.min(...visible);
  useEffect(() => {
    if (Number.isFinite(first)) stripRef.current?.children[first]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [first]);

  function goTo(i: number) {
    const board = boardRef.current;
    const col = board?.children[i] as HTMLElement | undefined;
    if (board && col) board.scrollTo({ left: board.scrollLeft + col.getBoundingClientRect().left - board.getBoundingClientRect().left, behavior: "smooth" });
  }

  function step(dir: 1 | -1) {
    const board = boardRef.current;
    if (board) board.scrollBy({ left: dir * Math.max(304, board.clientWidth - 304), behavior: "smooth" });
  }

  function startPan(event: React.PointerEvent<HTMLDivElement>) {
    const board = boardRef.current;
    // Solo con el mouse sobre el fondo: las tarjetas se arrastran entre etapas y los enlaces se abren.
    const target = event.target as HTMLElement;
    if (!board || event.pointerType !== "mouse" || event.button !== 0 || target.closest("a, button")) return;
    // Sobre una barra de desplazamiento (la del tablero o la de una columna) el navegador se encarga.
    if (event.nativeEvent.offsetX > target.clientWidth || event.nativeEvent.offsetY > target.clientHeight) return;
    const startX = event.clientX;
    const startLeft = board.scrollLeft;
    let moved = false;
    function onMove(e: PointerEvent) {
      if (!board) return;
      const dx = e.clientX - startX;
      if (!moved && Math.abs(dx) < 4) return;
      if (!moved) setPanning(true);
      moved = true;
      board.scrollLeft = startLeft - dx;
    }
    function onUp() {
      setPanning(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return { boardRef, stripRef, height, visible, atStart, atEnd, panning, goTo, step, startPan };
}

function AttentionBadge({ attention, waitingFor }: { attention: Attention; waitingFor: string | null }) {
  if (attention === "waiting") {
    return (
      <span title={waitingFor ? `El cliente escribió ${waitingFor} y nadie le ha respondido` : undefined} className="inline-flex shrink-0">
        <Badge tone="warning">
          <MessageCircleWarning aria-hidden />
          Sin atender
          {waitingFor && <span className="font-normal tabular-nums">· {waitingFor.replace(/^hace /, "")}</span>}
        </Badge>
      </span>
    );
  }
  return attention === "human" ? (
    <Badge tone="brand" className="shrink-0">
      <Headset aria-hidden />
      Ejecutivo
    </Badge>
  ) : (
    <Badge tone="success" className="shrink-0">
      <Bot aria-hidden />
      IA
    </Badge>
  );
}

const DUE_TONE: Record<TaskBucket, string> = {
  overdue: "bg-rose-50 text-rose-800 ring-rose-200",
  today: "bg-amber-50 text-amber-800 ring-amber-200",
  upcoming: "bg-slate-50 text-slate-700 ring-slate-200",
};

function TaskDue({ task }: { task: NonNullable<BoardLead["nextTask"]> }) {
  return (
    <p
      title={`Próxima tarea: ${task.title} (${task.due})`}
      className={`mt-2 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs ring-1 ring-inset ${DUE_TONE[task.bucket]}`}
    >
      <CalendarClock aria-hidden className="size-3.5 shrink-0" />
      <span className="truncate">{task.title}</span>
      <span className="ml-auto shrink-0 font-medium tabular-nums">{task.due}</span>
    </p>
  );
}

const CHANNEL_DOT: Record<Channel, string> = {
  WHATSAPP: "bg-[#25d366]",
  INSTAGRAM: "bg-[#e1306c]",
  FACEBOOK: "bg-[#1877f2]",
  WEB: "bg-brand-600",
  SIMULATOR: "bg-slate-400",
};

/** Iniciales del cliente con un punto del color de su canal; el nombre del canal va en el texto accesible. */
function ChannelAvatar({ name, channel, label }: { name: string; channel: Channel; label: string }) {
  return (
    <span className="relative shrink-0" title={label}>
      <Avatar name={name} />
      <span aria-hidden className={`absolute -bottom-0.5 -right-0.5 size-3 rounded-full ring-2 ring-white ${CHANNEL_DOT[channel]}`} />
      <span className="sr-only">{label}</span>
    </span>
  );
}
