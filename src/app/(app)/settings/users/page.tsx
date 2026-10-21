import { UserPlus } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { Avatar, Badge, PageHeader } from "@/components/ui";
import { Panel, SwitchSubmit } from "@/components/settings-ui";
import { setTakesLeadsAction, toggleUserAction } from "../actions";
import { NewUserForm } from "./form";

export default async function UsersPage() {
  const me = await requireAdmin();
  const [users, load] = await Promise.all([
    db.user.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] }),
    db.lead.groupBy({ by: ["assigneeId"], where: { status: "OPEN" }, _count: { _all: true } }),
  ]);
  const openLeads = (id: string) => load.find((l) => l.assigneeId === id)?._count._all ?? 0;
  const maxLoad = Math.max(1, ...users.map((u) => openLeads(u.id)));
  const active = users.filter((u) => u.active).length;

  return (
    <div className="space-y-6">
      <PageHeader title="Usuarios" description={`${active} ${active === 1 ? "usuario activo" : "usuarios activos"} de ${users.length}.`} />
      <ul className="stagger overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {users.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4 text-sm last:border-0">
            <div className={`flex min-w-0 flex-1 items-center gap-3 ${u.active ? "" : "opacity-60"}`}>
              <Avatar name={u.name} size="lg" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
                  {u.name}
                  <Badge tone={u.role === "ADMIN" ? "brand" : "neutral"}>{u.role === "ADMIN" ? "Admin" : "Ejecutivo"}</Badge>
                  {u.id === me.id && <Badge>Tú</Badge>}
                </div>
                <div className="truncate text-slate-600">{u.email}</div>
              </div>
            </div>
            {u.role === "ADMIN" && (
              <form action={setTakesLeadsAction.bind(null, u.id, !u.takesLeads)} className="flex items-center gap-2 text-xs text-slate-600">
                <span title="La asignación automática también le reparte leads, como a un ejecutivo">Atiende leads</span>
                <SwitchSubmit on={u.takesLeads} label={u.takesLeads ? `${u.name} deja de atender leads` : `${u.name} también atiende leads`} />
              </form>
            )}
            <div className="w-36" title={`${openLeads(u.id)} leads abiertos`}>
              <p className="text-right text-xs tabular-nums text-slate-600">{openLeads(u.id)} leads abiertos</p>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-brand-500 transition-[width] duration-500" style={{ width: `${(openLeads(u.id) / maxLoad) * 100}%` }} />
              </div>
            </div>
            <div className="flex w-11 justify-end">
              {u.id !== me.id && (
                <form action={toggleUserAction.bind(null, u.id, !u.active)}>
                  <SwitchSubmit on={u.active} label={u.active ? `Desactivar a ${u.name}` : `Activar a ${u.name}`} />
                </form>
              )}
            </div>
          </li>
        ))}
      </ul>
      <Panel icon={<UserPlus />} title="Nuevo usuario">
        <NewUserForm />
      </Panel>
    </div>
  );
}
