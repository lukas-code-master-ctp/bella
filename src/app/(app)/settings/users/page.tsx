import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { Button, Card, PageHeader } from "@/components/ui";
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
          <div key={u.id} className={`flex items-center gap-3 p-3 text-sm ${u.active ? "" : "opacity-50"}`}>
            <div className="flex-1">
              <div className="font-medium">{u.name}</div>
              <div className="text-slate-500">{u.email}</div>
            </div>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{u.role === "ADMIN" ? "Admin" : "Ejecutivo"}</span>
            <span className="w-28 text-right text-xs text-slate-500">{openLeads(u.id)} leads abiertos</span>
            {u.id !== me.id && (
              <form action={toggleUserAction.bind(null, u.id, !u.active)}>
                <Button variant="ghost">{u.active ? "Desactivar" : "Activar"}</Button>
              </form>
            )}
          </div>
        ))}
      </Card>
      <Card className="p-5">
        <h2 className="mb-4 font-medium">Nuevo usuario</h2>
        <NewUserForm />
      </Card>
    </>
  );
}
