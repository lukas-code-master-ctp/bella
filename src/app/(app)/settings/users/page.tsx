import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { Avatar, Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui";
import { toggleUserAction } from "../actions";
import { NewUserForm } from "./form";

export default async function UsersPage() {
  const me = await requireAdmin();
  const [users, load] = await Promise.all([
    db.user.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] }),
    db.lead.groupBy({ by: ["assigneeId"], where: { status: "OPEN" }, _count: { _all: true } }),
  ]);
  const openLeads = (id: string) => load.find((l) => l.assigneeId === id)?._count._all ?? 0;

  return (
    <>
      <PageHeader title="Usuarios" />
      <Card className="mb-6 divide-y divide-slate-100">
        {users.map((u) => (
          <div key={u.id} className="flex flex-wrap items-center gap-3 p-4 text-sm">
            <div className={`flex min-w-0 flex-1 items-center gap-3 ${u.active ? "" : "opacity-60"}`}>
              <Avatar name={u.name} />
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-semibold text-slate-900">
                  {u.name}
                  {!u.active && <Badge>Inactivo</Badge>}
                </div>
                <div className="truncate text-slate-600">{u.email}</div>
              </div>
            </div>
            <Badge tone={u.role === "ADMIN" ? "brand" : "neutral"}>{u.role === "ADMIN" ? "Admin" : "Ejecutivo"}</Badge>
            <span className="w-28 text-right text-xs tabular-nums text-slate-600">{openLeads(u.id)} leads abiertos</span>
            {u.id !== me.id && (
              <form action={toggleUserAction.bind(null, u.id, !u.active)}>
                <Button variant="ghost">{u.active ? "Desactivar" : "Activar"}</Button>
              </form>
            )}
          </div>
        ))}
      </Card>
      <Card className="p-5">
        <CardHeader title="Nuevo usuario" />
        <NewUserForm />
      </Card>
    </>
  );
}
