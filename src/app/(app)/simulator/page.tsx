import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, Field, inputClass, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
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
      <PageHeader title="Simulador de conversaciones" />
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-medium">Nueva conversación de prueba</h2>
          <p className="mt-1 text-sm text-slate-500">
            Crea un lead ficticio y conversa con la asistente como si fueras un cliente. Verás en vivo cómo
            responde, qué etiquetas asigna, cómo lo mueve por el funnel y cuándo deriva a un ejecutivo.
          </p>
          <form action={createSimulatedLeadAction} className="mt-4 space-y-3">
            <Field label="Nombre del cliente ficticio">
              <input name="name" placeholder="Ej. Pedro González" className={inputClass} />
            </Field>
            <SubmitButton pendingText="Creando…">Empezar conversación</SubmitButton>
          </form>
        </Card>
        <Card className="p-5">
          <h2 className="mb-3 font-medium">Pruebas recientes</h2>
          {leads.length === 0 ? (
            <p className="text-sm text-slate-500">Aún no hay conversaciones de prueba.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {leads.map((l) => (
                <li key={l.id}>
                  <Link href={`/leads/${l.id}`} className="flex justify-between py-2 text-sm hover:text-brand-600">
                    <span>{l.contact.name}</span>
                    <span className="text-slate-500">{l.status === "OPEN" ? l.stage.name : l.status === "WON" ? "Ganado" : "Perdido"}</span>
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
