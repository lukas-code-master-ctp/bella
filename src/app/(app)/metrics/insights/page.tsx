import Link from "next/link";
import { ArrowLeft, Mail, Sparkles } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { REPORT_SECTIONS, type WeeklyReport, type WeeklyStats } from "@/lib/ai/weekly-insights";
import { emailConfigured } from "@/lib/email";
import { getWeeklyEmailLog, getWeeklyEmailSettings, weeklyEmailRecipients } from "@/lib/domain/weekly-email";
import { Badge, buttonClass, Card, CardHeader, EmptyState, Field, inputClass, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { saveWeeklyEmailAction, sendWeeklyEmailNowAction } from "./actions";
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
  const [emailSettings, emailLog] = await Promise.all([getWeeklyEmailSettings(), getWeeklyEmailLog()]);
  const recipients = await weeklyEmailRecipients(emailSettings);
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

      <Card className="mt-6 p-5">
        <CardHeader
          icon={<Mail />}
          title="Envío por correo"
          description="Cada lunes, apenas está listo, el resumen llega por correo. Los correos salen por Resend: agrega RESEND_API_KEY en Vercel y verifica en Resend el dominio del remitente."
        >
          {emailConfigured() ? <Badge tone="success">Resend conectado</Badge> : <Badge>Falta RESEND_API_KEY</Badge>}
        </CardHeader>
        <form action={saveWeeklyEmailAction} className="space-y-4">
          <label className="flex min-h-10 items-center gap-2 text-sm font-medium text-slate-800">
            <input type="checkbox" name="enabled" defaultChecked={emailSettings.enabled} className="size-4 rounded border-slate-300 accent-brand-600" />
            Enviar el resumen por correo cada lunes
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Remitente" hint="De un dominio verificado en Resend. Ej. Reportes <reportes@miempresa.cl>">
              <input name="from" defaultValue={emailSettings.from} placeholder="Reportes <reportes@miempresa.cl>" className={inputClass} />
            </Field>
            <Field label="Otros destinatarios" hint="Separados por comas, por ejemplo la gerencia">
              <input name="extra" defaultValue={emailSettings.extra} placeholder="gerencia@miempresa.cl" className={inputClass} />
            </Field>
          </div>
          <label className="flex min-h-10 items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="toAdmins" defaultChecked={emailSettings.toAdmins} className="size-4 rounded border-slate-300 accent-brand-600" />
            Mandarlo también a todos los admins
          </label>
          <p className="text-xs text-slate-600">
            {recipients.length ? `Lo reciben: ${recipients.join(", ")}.` : "Todavía no hay destinatarios."}
          </p>
          <SubmitButton>Guardar</SubmitButton>
        </form>
        {insight && (
          <form action={sendWeeklyEmailNowAction.bind(null, insight.id)} className="mt-4 border-t border-slate-100 pt-4">
            <SubmitButton variant="secondary" pendingText="Enviando…">
              Enviar este resumen ahora
            </SubmitButton>
          </form>
        )}
        {emailLog && (
          <p className={`mt-3 text-xs ${emailLog.ok ? "text-slate-600" : "text-red-700"}`}>
            Último envío: {new Date(emailLog.at).toLocaleString("es-CL", { timeZone: "America/Santiago" })} · {emailLog.detail}
          </p>
        )}
      </Card>
    </>
  );
}
