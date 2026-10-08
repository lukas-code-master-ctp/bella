import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { INVENTORY_MAX_AGE_MS, type InventorySettings } from "@/lib/inventory";
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
            Última sincronización: {formatDate(settings.lastSyncAt)} · {settings.lastSyncRows} filas
          </p>
        )}
        {settings.lastError && settings.lastAttemptAt && (
          <p className="mt-1 text-xs text-rose-700">
            Falló el intento del {formatDate(settings.lastAttemptAt)}: {settings.lastError} La asistente sigue usando
            la última versión guardada.
          </p>
        )}
        {settings.sheetUrl && (
          <p className="mt-1 text-xs text-slate-600">
            Se actualiza sola una vez al día y cada vez que la asistente consulta el inventario y la copia tiene más
            de {INVENTORY_MAX_AGE_MS / 60_000} minutos.
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

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("es-CL", { timeZone: "America/Santiago" });
}
