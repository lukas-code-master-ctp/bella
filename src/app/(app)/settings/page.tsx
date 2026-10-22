import Link from "next/link";
import { ChevronRight, CircleCheck, CircleDashed } from "lucide-react";
import { setupChecklist, type SetupStep } from "@/lib/domain/setup-checklist";
import { Card, PageHeader } from "@/components/ui";

export default async function SettingsHome() {
  const steps = await setupChecklist();
  const required = steps.filter((s) => !s.optional);
  const optional = steps.filter((s) => s.optional);
  const done = required.filter((s) => s.done).length;
  const complete = done === required.length;

  return (
    <>
      <PageHeader
        title="Configura tu empresa"
        description="Los pasos para que la asistente atienda a tus clientes y veas qué anuncio te trae cada venta. Se marcan solos a medida que los completas."
      />
      <Card className="overflow-hidden">
        <div className="space-y-2 p-5">
          <p className="text-sm font-medium text-slate-900">
            {complete ? "Todo listo. Beliapp está atendiendo y midiendo." : `${done} de ${required.length} pasos listos`}
          </p>
          <div
            className="h-2 overflow-hidden rounded-full bg-slate-100"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={required.length}
            aria-valuenow={done}
            aria-label="Avance de la configuración"
          >
            <div className="h-full rounded-full bg-brand-500 transition-[width] duration-300" style={{ width: `${(done / required.length) * 100}%` }} />
          </div>
        </div>
        <StepList steps={required} />
        {optional.length > 0 && (
          <>
            <p className="border-t border-slate-100 bg-slate-50 px-5 py-2 text-xs font-medium text-slate-500">
              Opcional · no cuenta en el avance
            </p>
            <StepList steps={optional} />
          </>
        )}
      </Card>
    </>
  );
}

function StepList({ steps }: { steps: SetupStep[] }) {
  return (
    <ol className="divide-y divide-slate-100 border-t border-slate-100">
      {steps.map((s) => (
        <li key={s.id}>
          <Link
            href={s.href}
            className="group flex items-center gap-3 px-5 py-3.5 transition-colors duration-150 hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none"
          >
            {s.done ? (
              <CircleCheck aria-label="Listo" className="size-5 shrink-0 text-emerald-600" />
            ) : (
              <CircleDashed aria-label="Pendiente" className="size-5 shrink-0 text-slate-400" />
            )}
            <span className="min-w-0 flex-1">
              <span className={`block text-sm font-medium ${s.done ? "text-slate-500" : "text-slate-900"}`}>{s.title}</span>
              <span className="block text-xs text-slate-600">{s.description}</span>
            </span>
            <ChevronRight aria-hidden className="size-4 shrink-0 text-slate-400 transition-transform duration-150 group-hover:translate-x-0.5" />
          </Link>
        </li>
      ))}
    </ol>
  );
}
