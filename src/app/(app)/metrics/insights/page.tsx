import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { REPORT_SECTIONS, type WeeklyReport, type WeeklyStats } from "@/lib/ai/weekly-insights";
import { buttonClass, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { GenerateButton } from "./generate-button";

const day = (d: Date) => d.toLocaleDateString("es-CL", { day: "numeric", month: "short", timeZone: "America/Santiago" });
const int = (n: number) => n.toLocaleString("es-CL");

export default async function WeeklyInsightsPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const user = await requireAdmin();
  const { id } = await searchParams;
  const history = await db.weeklyInsight.findMany({
    orderBy: { periodEnd: "desc" },
    take: 12,
    select: { id: true, periodStart: true, periodEnd: true },
  });
  const insight = await db.weeklyInsight.findFirst({ where: id ? { id } : {}, orderBy: { periodEnd: "desc" } });
  if (insight && !insight.seenBy.includes(user.id)) {
    await db.weeklyInsight.update({ where: { id: insight.id }, data: { seenBy: { push: user.id } } });
  }
  const report = insight?.report as WeeklyReport | undefined;
  const stats = insight?.stats as WeeklyStats | undefined;
  // El período termina a las 00:00 del día siguiente al último incluido.
  const lastDay = insight ? new Date(insight.periodEnd.getTime() - 1) : null;

  return (
    <>
      <PageHeader
        title="Resumen semanal"
        description="Cada lunes a las 9:00 la IA lee las conversaciones de la semana y resume qué piden los clientes, dónde se traba el embudo y qué conviene hacer."
      >
        <Link href="/metrics" className={buttonClass("ghost")}>
          <ArrowLeft aria-hidden />
          Métricas
        </Link>
        <GenerateButton />
      </PageHeader>

      {!insight || !report ? (
        <Card>
          <EmptyState icon={<Sparkles />} title="Aún no hay resúmenes">
            El primero llega el próximo lunes. También puedes generarlo ahora con los últimos 7 días.
          </EmptyState>
        </Card>
      ) : (
        <div className="stagger space-y-6">
          {history.length > 1 && (
            <nav aria-label="Semanas anteriores" className="flex flex-wrap gap-2">
              {history.map((h) => (
                <Link
                  key={h.id}
                  href={`/metrics/insights?id=${h.id}`}
                  aria-current={h.id === insight.id ? "page" : undefined}
                  className={buttonClass(h.id === insight.id ? "primary" : "secondary", "sm")}
                >
                  {day(h.periodStart)} – {day(new Date(h.periodEnd.getTime() - 1))}
                </Link>
              ))}
            </nav>
          )}

          <Card className="p-5">
            <CardHeader
              icon={<Sparkles />}
              title={`Semana del ${day(insight.periodStart)} al ${day(lastDay!)}`}
              description={stats ? `${int(stats.leads)} leads nuevos · ${int(stats.activeLeads)} con conversación · ${int(stats.won)} ganados · ${int(stats.lost)} perdidos` : undefined}
            />
            <p className="whitespace-pre-line text-sm leading-relaxed text-slate-800">{report.summary}</p>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            {REPORT_SECTIONS.filter((s) => report[s.key]?.length).map((s) => (
              <Card key={s.key} className={`p-5 ${s.key === "recommendations" ? "lg:col-span-2" : ""}`}>
                <CardHeader title={s.title} />
                <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-700 marker:text-brand-500">
                  {report[s.key].map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
          <p className="text-xs text-slate-500">Generado por la IA ({insight.model}). Revisa los datos antes de tomar decisiones importantes.</p>
        </div>
      )}
    </>
  );
}
