import Link from "next/link";
import { GraduationCap, Merge, MessageSquareText, PencilLine } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { listLessons } from "@/lib/domain/ai-lessons";
import { markLessonNotificationsRead } from "@/lib/domain/notifications";
import { formatChileDateTime } from "@/lib/domain/follow-ups";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { Disclosure, StatusPill } from "@/components/settings-ui";
import { IntegratePanel } from "./integrate-panel";
import { LessonForm } from "./lesson-form";

// Integrar reescribe las instrucciones completas con la IA: puede tardar más que el límite normal.
export const maxDuration = 300;

const STATUS = {
  PENDING: { title: "Por revisar", hint: "Nada de esto llega a los clientes hasta que lo apruebes." },
  ACTIVE: { title: "Activos", hint: "La IA los sigue en todas las conversaciones, por sobre las instrucciones si chocan." },
  PAUSED: { title: "Pausados", hint: "Aprobados antes, pero apagados." },
  INTEGRATED: {
    title: "Integrados en las instrucciones",
    hint: "Ya son parte del texto de Configuración → Asistente, así que no se envían aparte. Quedan aquí como historial.",
  },
} as const;

export default async function LessonsPage() {
  const user = await requireUser();
  const [lessons] = await Promise.all([listLessons(), markLessonNotificationsRead(user.id)]);
  const activeCount = lessons.filter((l) => l.status === "ACTIVE").length;
  const groups = (["PENDING", "ACTIVE", "PAUSED", "INTEGRATED"] as const)
    .map((status) => ({ status, lessons: lessons.filter((l) => l.status === status) }))
    .filter((g) => g.lessons.length);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Aprendizajes de la asistente"
        description="Reglas que la IA sigue además de sus instrucciones. Se crean al analizar una respuesta desde el chat, o las proponen los ejecutivos con «Corregir» y tú las apruebas aquí."
      />

      {groups.length === 0 && (
        <Card className="animate-rise">
          <EmptyState icon={<GraduationCap />} title="Aún no hay aprendizajes">
            Cuando una respuesta de la IA no te guste, toca «Analizar» bajo ella en el chat. Si el arreglo es un aprendizaje, queda aquí; las
            reglas que propongan los ejecutivos con «Corregir» también llegan aquí para que las revises.
          </EmptyState>
        </Card>
      )}

      {groups.map((g) => (
        <section key={g.status} className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {STATUS[g.status].title} <span className="text-slate-400">· {g.lessons.length}</span>
            </h2>
            <p className="text-sm text-slate-600">{STATUS[g.status].hint}</p>
          </div>
          {g.status === "INTEGRATED" ? (
            <Card className="divide-y divide-slate-100">
              {g.lessons.map((l) => (
                <div key={l.id} className="flex items-start gap-3 p-4">
                  <Merge aria-hidden className="mt-0.5 size-4 shrink-0 text-slate-400" />
                  <div className="min-w-0">
                    <p className="text-sm text-slate-800">{l.rule}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {l.createdBy || "Equipo"} · integrado el {formatChileDateTime(l.integratedAt ?? l.updatedAt)}
                    </p>
                  </div>
                </div>
              ))}
            </Card>
          ) : (
          <div className="stagger space-y-3">
            {g.lessons.map((l) => (
              <Disclosure
                key={l.id}
                icon={<PencilLine />}
                defaultOpen={l.status === "PENDING"}
                muted={l.status === "PAUSED"}
                summary={
                  <>
                    <p className="line-clamp-2 text-sm font-semibold text-slate-900">{l.rule}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                      <span>
                        {l.createdBy || "Equipo"} · {formatChileDateTime(l.createdAt)}
                      </span>
                      {l.leadId && (
                        <Link href={`/leads/${l.leadId}`} className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
                          <MessageSquareText aria-hidden className="size-3.5" />
                          Ver conversación
                        </Link>
                      )}
                    </p>
                  </>
                }
                aside={
                  l.status === "PENDING" ? (
                    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
                      Por revisar
                    </span>
                  ) : (
                    <StatusPill on={l.status === "ACTIVE"} onLabel="Activo" offLabel="Pausado" />
                  )
                }
              >
                <LessonForm
                  key={l.id}
                  lesson={{
                    id: l.id,
                    status: l.status,
                    rule: l.rule,
                    badExample: l.badExample,
                    goodExample: l.goodExample,
                    feedback: l.feedback,
                    conflict: l.conflict,
                    testReply: l.testReply,
                    testedAt: l.testedAt ? formatChileDateTime(l.testedAt) : null,
                  }}
                />
              </Disclosure>
            ))}
          </div>
          )}
          {g.status === "ACTIVE" && <IntegratePanel activeCount={activeCount} />}
        </section>
      ))}
    </div>
  );
}
