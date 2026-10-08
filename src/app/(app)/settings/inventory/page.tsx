import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import type { InventorySettings } from "@/lib/inventory";
import { Card, PageHeader } from "@/components/ui";
import { InventoryForm } from "./form";

export default async function InventoryPage() {
  const settings = await getSetting<InventorySettings>("inventory", { sheetUrl: "" });
  const items = await db.inventoryItem.findMany({ orderBy: { rowNumber: "asc" }, take: 50 });
  const total = await db.inventoryItem.count();
  const columns = [...new Set(items.flatMap((i) => Object.keys(i.data as object)))];

  return (
    <>
      <PageHeader title="Inventario" />
      <Card className="mb-6 p-5">
        <InventoryForm sheetUrl={settings.sheetUrl} />
        {settings.lastSyncAt && (
          <p className="mt-3 text-xs text-slate-500">
            Última sincronización: {new Date(settings.lastSyncAt).toLocaleString("es-CL")} · {settings.lastSyncRows} filas
          </p>
        )}
      </Card>
      {items.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                {columns.map((c) => (
                  <th key={c} className="px-3 py-2 font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((i) => {
                const row = i.data as Record<string, string>;
                return (
                  <tr key={i.id}>
                    {columns.map((c) => (
                      <td key={c} className="px-3 py-2">
                        {row[c]}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {total > items.length && (
            <p className="p-3 text-xs text-slate-500">Mostrando {items.length} de {total} filas.</p>
          )}
        </Card>
      )}
    </>
  );
}
