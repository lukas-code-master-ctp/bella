import { Download, Upload, UsersRound } from "lucide-react";
import { db } from "@/lib/db";
import { findDuplicateGroups } from "@/lib/domain/contact-import";
import { buttonClass, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { DuplicateGroup, ImportForm } from "./forms";

export const maxDuration = 300;

export default async function ContactsSettingsPage() {
  const [total, fields, groups] = await Promise.all([
    db.contact.count({ where: { channel: { not: "SIMULATOR" } } }),
    db.customField.findMany({ orderBy: { position: "asc" }, select: { name: true } }),
    findDuplicateGroups(),
  ]);
  const columns = ["Nombre", "Teléfono", "Correo", "Etiquetas", "Embudo", "Etapa", "Ejecutivo", ...fields.map((f) => f.name)];

  return (
    <>
      <PageHeader
        title="Contactos"
        description="Importa tu base desde otro CRM, descárgala en CSV y fusiona los contactos repetidos."
      />
      <div className="space-y-6">
        <Card className="p-5">
          <CardHeader
            icon={<Upload />}
            title="Importar CSV"
            description="Un contacto que ya existe (mismo WhatsApp o correo) se completa en vez de duplicarse. Cada contacto sin lead abierto queda con uno en la etapa indicada o en la primera."
          />
          <p className="mt-3 text-sm text-slate-700">
            Columnas que se reconocen: {columns.join(", ")}. Se necesita teléfono o correo. Las etiquetas van como
            «Categoría: etiqueta», separadas por punto y coma; el ejecutivo, con su correo o su nombre.
          </p>
          <ImportForm />
        </Card>

        <Card className="p-5">
          <CardHeader icon={<Download />} title="Exportar" description={`${total.toLocaleString("es-CL")} contactos, con su último lead, etiquetas y campos del cliente.`} />
          <a href="/settings/contacts/export" download className={buttonClass("secondary", "md", "mt-4")}>
            <Download aria-hidden />
            Descargar CSV
          </a>
        </Card>

        <Card className="p-5">
          <CardHeader
            icon={<UsersRound />}
            title="Contactos repetidos"
            description="Mismo teléfono o mismo correo. Al fusionar, el primero se queda con los leads, etiquetas y campos de los demás."
          />
          {groups.length === 0 ? (
            <div className="mt-4">
              <EmptyState icon={<UsersRound />} title="No hay contactos repetidos" />
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100">
              {groups.slice(0, 50).map((g) => (
                <DuplicateGroup
                  key={g[0].id}
                  contacts={g.map((c) => ({ ...c, createdAt: c.createdAt.toLocaleDateString("es-CL") }))}
                />
              ))}
            </ul>
          )}
          {groups.length > 50 && (
            <p className="mt-3 text-xs text-slate-600">Se muestran 50 de {groups.length} grupos; fusiona estos para ver los siguientes.</p>
          )}
        </Card>
      </div>
    </>
  );
}
