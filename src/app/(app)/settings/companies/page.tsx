import { Building2, LogIn } from "lucide-react";
import { requireSuperadmin } from "@/lib/auth";
import { listCompanies } from "@/lib/domain/companies";
import { currentCompanyId } from "@/lib/tenant";
import { Badge, PageHeader } from "@/components/ui";
import { Panel } from "@/components/settings-ui";
import { SubmitButton } from "@/components/submit-button";
import { enterCompanyAction } from "./actions";
import { NewCompanyForm } from "./form";

export default async function CompaniesPage() {
  await requireSuperadmin();
  const [companies, current] = await Promise.all([listCompanies(), currentCompanyId()]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Empresas"
        description="Cada empresa tiene sus leads, su equipo, su configuración y sus credenciales. Sus usuarios entran por el mismo link y solo ven la suya; tú puedes entrar a cualquiera."
      />
      <ul className="stagger overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {companies.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4 text-sm last:border-0">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 [&_svg]:size-5">
              <Building2 aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
                {c.name}
                {c.id === current && <Badge tone="brand">Estás aquí</Badge>}
              </div>
              <div className="text-slate-600 tabular-nums">
                {c.users} {c.users === 1 ? "usuario" : "usuarios"} · {c.openLeads} {c.openLeads === 1 ? "lead abierto" : "leads abiertos"}
              </div>
            </div>
            {c.id !== current && (
              <form action={enterCompanyAction.bind(null, c.id)}>
                <SubmitButton variant="secondary" size="sm" pendingText="Entrando…">
                  <LogIn aria-hidden />
                  Entrar
                </SubmitButton>
              </form>
            )}
          </li>
        ))}
      </ul>
      <Panel icon={<Building2 />} title="Nueva empresa" description="Con su primer administrador. Él entra con su correo y crea al resto del equipo.">
        <NewCompanyForm />
      </Panel>
    </div>
  );
}
