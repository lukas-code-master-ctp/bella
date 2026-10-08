"use client";

import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import { TagPill } from "@/components/ui";
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

  function onDrop(event: React.DragEvent, stageId: string) {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/plain");
    const lead = optimistic.find((l) => l.id === id);
    if (!lead || lead.stageId === stageId) return;
    startTransition(async () => {
      move({ id, stageId });
      await moveLeadAction(id, stageId);
    });
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {stages.map((stage) => {
        const items = optimistic.filter((l) => l.stageId === stage.id);
        return (
          <section
            key={stage.id}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => onDrop(e, stage.id)}
            className="flex w-72 shrink-0 flex-col rounded-lg bg-slate-100"
          >
            <header className="flex items-center gap-2 border-b-2 px-3 py-2" style={{ borderColor: stage.color }}>
              <span className="font-medium text-slate-800">{stage.name}</span>
              {stage.requiresHuman && (
                <span className="rounded bg-amber-100 px-1.5 text-[10px] font-semibold uppercase text-amber-700">
                  Humano
                </span>
              )}
              <span className="ml-auto text-xs text-slate-500">{items.length}</span>
            </header>
            <div className="flex min-h-24 flex-1 flex-col gap-2 p-2">
              {items.map((lead) => (
                <Link
                  key={lead.id}
                  href={`/leads/${lead.id}`}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", lead.id)}
                  className="block cursor-grab rounded-md border border-slate-200 bg-white p-3 shadow-sm hover:border-brand-500"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-slate-900">{lead.name}</span>
                    <span
                      title={lead.aiEnabled ? "IA activa" : "IA pausada"}
                      className={`mt-1 h-2 w-2 shrink-0 rounded-full ${lead.aiEnabled ? "bg-emerald-500" : "bg-slate-300"}`}
                    />
                  </div>
                  {lead.lastMessage && <p className="mt-1 line-clamp-2 text-xs text-slate-500">{lead.lastMessage}</p>}
                  {lead.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {lead.tags.map((t) => (
                        <TagPill key={t.label} {...t} />
                      ))}
                    </div>
                  )}
                  <div className="mt-2 flex justify-between text-[11px] text-slate-400">
                    <span>{lead.assignee ?? "Sin asignar"}</span>
                    <span>{lead.channel}</span>
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
