"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { Bot, BotOff, UserRound } from "lucide-react";
import { Avatar, Badge, TagPill } from "@/components/ui";
import { moveLeadAction } from "./actions";

export type BoardLead = {
  id: string;
  stageId: string;
  name: string;
  channel: string;
  assignee: string | null;
  aiEnabled: boolean;
  lastMessage: string | null;
  tags: { label: string; color: string }[];
  updatedAt: string;
};

export type BoardStage = { id: string; name: string; color: string; requiresHuman: boolean };

export function Board({ stages, leads }: { stages: BoardStage[]; leads: BoardLead[] }) {
  const [optimistic, move] = useOptimistic(leads, (state, { id, stageId }: { id: string; stageId: string }) =>
    state.map((l) => (l.id === id ? { ...l, stageId } : l)),
  );
  const [, startTransition] = useTransition();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

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
    <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
      {stages.map((stage) => {
        const items = optimistic.filter((l) => l.stageId === stage.id);
        const isOver = over === stage.id && dragging !== null;
        return (
          <section
            key={stage.id}
            aria-label={`${stage.name}: ${items.length} leads`}
            onDragOver={(e) => {
              e.preventDefault();
              if (over !== stage.id) setOver(stage.id);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
            }}
            onDrop={(e) => onDrop(e, stage.id)}
            className={`flex w-[288px] shrink-0 snap-start flex-col rounded-xl border transition-colors duration-150 ${
              isOver ? "border-brand-300 bg-brand-50" : "border-transparent bg-slate-100"
            }`}
          >
            <header className="flex items-center gap-2 px-3 pb-2 pt-3">
              <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: stage.color }} />
              <h2 className="truncate text-sm font-semibold text-slate-900">{stage.name}</h2>
              {stage.requiresHuman && (
                <Badge tone="warning">
                  <UserRound aria-hidden />
                  Humano
                </Badge>
              )}
              <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-700 ring-1 ring-inset ring-slate-200">
                {items.length}
              </span>
            </header>
            <div className="flex min-h-28 flex-1 flex-col gap-2 p-2 pt-1">
              {items.length === 0 && (
                <p className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500">
                  {isOver ? "Suelta aquí" : "Sin leads"}
                </p>
              )}
              {items.map((lead) => (
                <Link
                  key={lead.id}
                  href={`/leads/${lead.id}`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", lead.id);
                    setDragging(lead.id);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                  className={`group block cursor-grab rounded-lg border border-slate-200 bg-white p-3 shadow-xs transition-[border-color,box-shadow,opacity] duration-150 hover:border-brand-300 hover:shadow-md active:cursor-grabbing ${
                    dragging === lead.id ? "opacity-50" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold leading-snug text-slate-900 group-hover:text-brand-700">{lead.name}</span>
                    {lead.aiEnabled ? (
                      <Badge tone="success" className="shrink-0">
                        <Bot aria-hidden />
                        IA
                      </Badge>
                    ) : (
                      <Badge tone="neutral" className="shrink-0">
                        <BotOff aria-hidden />
                        Pausada
                      </Badge>
                    )}
                  </div>
                  {lead.lastMessage && <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-slate-600">{lead.lastMessage}</p>}
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
                    <span className="ml-auto shrink-0 text-slate-500">{lead.channel}</span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
