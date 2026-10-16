import { Download, Upload, UsersRound } from "lucide-react";
import { TIME_ZONE } from "@/lib/dates";
import { db } from "@/lib/db";
import { findDuplicateGroups } from "@/lib/domain/contact-import";
import { buttonClass, EmptyState, PageHeader } from "@/components/ui";
import { FieldGroup, Panel, PanelBody, Stat } from "@/components/settings-ui";
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
    <div className="space-y-6">
      <PageHeader title="Contactos" description="Importa tu base desde otro CRM, descárgala en CSV y fusiona los contactos repetidos." />

      <div className="stagger grid gap-3 sm:grid-cols-2">
        <Stat icon={<UsersRound />} label="Contactos" value={total.toLocaleString("es-CL")} hint="Sin contar los del simulador" />
        <Stat icon={<UsersRound />} label="Grupos repetidos" value={groups.length.toLocaleString("es-CL")} hint="Mismo teléfono o correo" />
      </div>

      <Panel
        icon={<Upload />}
        title="Importar CSV"
        description="Un contacto que ya existe (mismo WhatsApp o correo) se completa en vez de duplicarse. Cada contacto sin lead abierto queda con uno en la etapa indicada o en la primera."
      >
        <PanelBody className="pb-0">
          <FieldGroup
            title="Columnas que se reconocen"
            description="Se necesita teléfono o correo. Las etiquetas van como «Categoría: etiqueta», separadas por punto y coma; el ejecutivo, con su correo o su nombre."
          >
            <div className="flex flex-wrap gap-1.5">
              {columns.map((c) => (
                <span key={c} className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700">
                  {c}
                </span>
              ))}
            </div>
          </FieldGroup>
        </PanelBody>
        <ImportForm />
      </Panel>

      <Panel
        icon={<Download />}
        title="Exportar"
        description={`${total.toLocaleString("es-CL")} contactos, con su último lead, etiquetas y campos del cliente.`}
        aside={
          <a href="/settings/contacts/export" download className={buttonClass("secondary", "sm")}>
            <Download aria-hidden />
            Descargar CSV
          </a>
        }
      />

      <Panel
        icon={<UsersRound />}
        title="Contactos repetidos"
        description="Mismo teléfono o mismo correo. Al fusionar, el primero se queda con los leads, etiquetas y campos de los demás."
      >
        {groups.length === 0 ? (
          <EmptyState icon={<UsersRound />} title="No hay contactos repetidos" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {groups.slice(0, 50).map((g) => (
              <DuplicateGroup key={g[0].id} contacts={g.map((c) => ({ ...c, createdAt: c.createdAt.toLocaleDateString("es-CL", { timeZone: TIME_ZONE }) }))} />
            ))}
          </ul>
        )}
        {groups.length > 50 && (
          <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-600">
            Se muestran 50 de {groups.length} grupos; fusiona estos para ver los siguientes.
          </p>
        )}
      </Panel>
    </div>
  );
}
