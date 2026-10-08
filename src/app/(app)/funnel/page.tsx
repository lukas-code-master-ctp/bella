import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { CHANNEL_LABEL } from "@/lib/labels";
import { PageHeader } from "@/components/ui";
import { Board } from "./board";

export default async function FunnelPage({ searchParams }: { searchParams: Promise<{ executive?: string }> }) {
  const user = await requireUser();
  const { executive } = await searchParams;
  const scope: Prisma.LeadWhereInput =
    user.role === "ADMIN" ? (executive ? { assigneeId: executive === "none" ? null : executive } : {}) : { assigneeId: user.id };

  const [stages, leads, closed, executives] = await Promise.all([
    db.stage.findMany({ orderBy: { position: "asc" } }),
    db.lead.findMany({
      where: { ...scope, status: "OPEN" },
      include: {
        contact: { include: { tags: { include: { tag: true } } } },
        assignee: true,
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { updatedAt: "desc" },
    }),
    db.lead.groupBy({ by: ["status"], where: { ...scope, status: { not: "OPEN" } }, _count: { _all: true } }),
    user.role === "ADMIN" ? db.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }) : [],
  ]);
  const count = (s: string) => closed.find((c) => c.status === s)?._count._all ?? 0;

  return (
    <>
      <PageHeader title="Funnel de ventas">
        <div className="flex items-center gap-4 text-sm">
          <span className="text-emerald-700">Ganados: {count("WON")}</span>
          <span className="text-rose-700">Perdidos: {count("LOST")}</span>
          {user.role === "ADMIN" && (
            <form className="flex items-center gap-2">
              <select name="executive" defaultValue={executive ?? ""} className="rounded-md border border-slate-300 px-2 py-1 text-sm">
                <option value="">Todos los ejecutivos</option>
                <option value="none">Sin asignar</option>
                {executives.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
              <button className="text-brand-600 hover:underline">Filtrar</button>
            </form>
          )}
          <Link href="/simulator" className="rounded-md bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-700">
            Probar en simulador
          </Link>
        </div>
      </PageHeader>
      {stages.length === 0 ? (
        <p className="text-slate-500">No hay etapas configuradas. Créalas en Configuración → Funnel.</p>
      ) : (
        <Board
          stages={stages.map(({ id, name, color, requiresHuman }) => ({ id, name, color, requiresHuman }))}
          leads={leads.map((l) => ({
            id: l.id,
            stageId: l.stageId,
            name: l.contact.name,
            channel: CHANNEL_LABEL[l.contact.channel],
            assignee: l.assignee?.name ?? null,
            aiEnabled: l.aiEnabled,
            lastMessage: l.messages[0]?.body ?? null,
            tags: l.contact.tags.map((ct) => ({ label: ct.tag.name, color: ct.tag.color })),
            updatedAt: l.updatedAt.toISOString(),
          }))}
        />
      )}
    </>
  );
}
