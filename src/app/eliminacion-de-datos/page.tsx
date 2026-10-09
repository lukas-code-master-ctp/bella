import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { findDeletionRequest, getLegalSettings } from "@/lib/domain/privacy";
import { formatChileDateTime } from "@/lib/domain/follow-ups";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Eliminación de datos" };

export default async function DataDeletionPage({ searchParams }: { searchParams: Promise<{ codigo?: string }> }) {
  const { codigo } = await searchParams;
  const [request, { legalName, contactEmail }] = await Promise.all([
    codigo ? findDeletionRequest(codigo) : null,
    getLegalSettings(),
  ]);
  return (
    <LegalPage title="Eliminación de datos">
      {codigo && (
        <div role="status" className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          {request ? (
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
        Más detalles en nuestra <a href="/privacidad">política de privacidad</a>.
      </p>
    </LegalPage>
  );
}
