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
      <PageHeader title="Inventario" description="La asistente busca en esta planilla para responder sobre productos, precios y stock." />
      <Card className="mb-6 p-5">
        <InventoryForm sheetUrl={settings.sheetUrl} />
        {settings.lastSyncAt && (
          <p className="mt-3 text-xs text-slate-600">
            Última sincronización: {new Date(settings.lastSyncAt).toLocaleString("es-CL")} · {settings.lastSyncRows} filas
          </p>
        )}
      </Card>
      {items.length > 0 && (
        <Card className="max-h-[70dvh] overflow-auto">
          <table className="w-full text-left text-sm tabular-nums">
            <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-600 shadow-[inset_0_-1px_0] shadow-slate-200">
              <tr>
                {columns.map((c) => (
                  <th key={c} className="whitespace-nowrap px-3 py-2.5 font-semibold">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((i) => {
                const row = i.data as Record<string, string>;
                return (
                  <tr key={i.id} className="hover:bg-slate-50">
                    {columns.map((c) => (
                      <td key={c} className="px-3 py-2 text-slate-800">
                        {row[c]}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {total > items.length && (
            <p className="p-3 text-xs text-slate-600">Mostrando {items.length} de {total} filas.</p>
          )}
        </Card>
      )}
    </>
  );
}
