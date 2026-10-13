import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { publicCompanyId } from "@/lib/company-request";
import { withCompany } from "@/lib/tenant";
import { LegalPage } from "@/components/legal-page";
import { findDeletionRequest, getLegalSettings } from "@/lib/domain/privacy";
import { formatChileDateTime } from "@/lib/domain/follow-ups";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Eliminación de datos" };

/** Cada empresa tiene la suya: /eliminacion-de-datos?c=<empresa>; sin `c`, la de la empresa por defecto. */
export default async function DataDeletionPage({ searchParams }: { searchParams: Promise<{ codigo?: string; c?: string }> }) {
  const { codigo, c } = await searchParams;
  const companyId = await publicCompanyId(c);
  if (!companyId) notFound();
  const [request, { legalName, contactEmail }] = await withCompany(companyId, () =>
    Promise.all([codigo ? findDeletionRequest(codigo) : null, getLegalSettings()]),
  );
  const query = c ? `?c=${encodeURIComponent(companyId)}` : "";
  return (
    <LegalPage title="Eliminación de datos">
      {codigo && (
        <div role="status" className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          {request?.pending ? (
            <p>
              <b>Solicitud {request.code}: en revisión.</b> No encontramos datos asociados automáticamente a tu cuenta;
              nuestro equipo la revisará a mano dentro de 30 días.
              {contactEmail && (
                <>
                  {" "}Si quieres, escribe a <a href={`mailto:${contactEmail}`}>{contactEmail}</a> con este código y el
                  nombre con que nos escribiste.
                </>
              )}
            </p>
          ) : request ? (
            <p>
              <b>Solicitud {request.code}: completada.</b> El {formatChileDateTime(request.createdAt)} eliminamos tus
              conversaciones, comentarios y datos de contacto asociados a tu cuenta.
            </p>
          ) : (
            <p>
              No encontramos una solicitud con el código <b>{codigo}</b>. Revisa que esté bien escrito.
            </p>
          )}
        </div>
      )}
      <p>
        Puedes pedir que {legalName} elimine todos los datos que guarda sobre ti (conversaciones, notas de voz,
        comentarios y datos de contacto) de dos formas:
      </p>
      <ul>
        <li>
          Desde Facebook o Instagram: en Configuración → Apps y sitios web, quita nuestra app y elige eliminar tus datos.
          Lo hacemos automáticamente y te entregamos un código para consultar el estado en esta página.
        </li>
        <li>
          Escribiendo a {contactEmail ? <a href={`mailto:${contactEmail}`}>{contactEmail}</a> : "nuestros canales de atención"} con
          tu nombre y el canal por el que nos escribiste (por ejemplo, tu número de WhatsApp). Respondemos dentro de 30 días.
        </li>
      </ul>
      <p>
        Más detalles en nuestra <a href={`/privacidad${query}`}>política de privacidad</a>.
      </p>
    </LegalPage>
  );
}
