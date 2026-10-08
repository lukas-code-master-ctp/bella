import Link from "next/link";
import { ChevronRight, FlaskConical, History, MessageCircle } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Avatar, Badge, Card, CardHeader, EmptyState, Field, inputClass, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { LinkPending } from "@/components/link-pending";
import { createSimulatedLeadAction } from "./actions";

export default async function SimulatorPage() {
  const user = await requireUser();
  const leads = await db.lead.findMany({
    where: { contact: { channel: "SIMULATOR" }, ...(user.role === "ADMIN" ? {} : { assigneeId: user.id }) },
    include: { contact: true, stage: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return (
    <>
      <PageHeader
        title="Simulador de conversaciones"
        description="Prueba a la asistente antes de conectarla a clientes reales."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="h-fit p-5">
          <CardHeader
            icon={<FlaskConical />}
            title="Nueva conversación de prueba"
            description="Crea un lead ficticio y conversa con la asistente como si fueras un cliente. Verás en vivo cómo responde, qué etiquetas asigna, cómo lo mueve por el funnel y cuándo deriva a un ejecutivo."
          />
          <form action={createSimulatedLeadAction} className="space-y-4">
            <Field label="Nombre del cliente ficticio">
              <input name="name" placeholder="Ej. Pedro González" className={inputClass} />
            </Field>
            <SubmitButton pendingText="Creando…">
              <MessageCircle aria-hidden />
              Empezar conversación
            </SubmitButton>
          </form>
        </Card>
        <Card className="overflow-hidden">
          <div className="px-5 pt-5">
            <CardHeader icon={<History />} title="Pruebas recientes" />
          </div>
          {leads.length === 0 ? (
            <EmptyState icon={<MessageCircle />} title="Aún no hay conversaciones de prueba">
              Crea la primera con el formulario.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100 border-t border-slate-100">
              {leads.map((l) => (
                <li key={l.id}>
                  <Link
                    href={`/leads/${l.id}`}
                    className="relative flex min-h-14 items-center gap-3 px-5 py-2.5 text-sm transition-colors duration-150 hover:bg-slate-50"
                  >
                    <Avatar name={l.contact.name} />
                    <span className="min-w-0 flex-1 truncate font-medium text-slate-900">{l.contact.name}</span>
                    {l.status === "OPEN" ? (
                      <Badge>{l.stage.name}</Badge>
                    ) : l.status === "WON" ? (
                      <Badge tone="success">Ganado</Badge>
                    ) : (
                      <Badge tone="danger">Perdido</Badge>
                    )}
                    <ChevronRight aria-hidden className="size-4 text-slate-400" />
                    <LinkPending />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
