import { requireAdmin } from "@/lib/auth";
import { exportContactsCsv } from "@/lib/domain/contact-import";

export const dynamic = "force-dynamic";

/** Descarga de todos los contactos en CSV (solo admin). */
export async function GET() {
  await requireAdmin();
  const csv = await exportContactsCsv();
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="contactos-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
