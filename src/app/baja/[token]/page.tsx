import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { publicCompanyId } from "@/lib/company-request";
import { withCompany } from "@/lib/tenant";
import { db } from "@/lib/db";
import { LegalPage } from "@/components/legal-page";
import { SubmitButton } from "@/components/submit-button";
import { getEmailDomain } from "@/lib/domain/email-domains";
import { getLegalSettings } from "@/lib/domain/privacy";
import { normalizeEmail, readUnsubscribeToken } from "@/lib/domain/email-suppression";
import { resubscribeAction, unsubscribeAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dejar de recibir correos", robots: { index: false } };

/**
 * Página del enlace de baja que va al pie de cada envío masivo por correo. Abrirla no da de
 * baja (los antivirus de correo abren los enlaces solos): hay que apretar el botón.
 */
export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = readUnsubscribeToken(token);
  const companyId = data && (await publicCompanyId(data.companyId));
  if (!data || !companyId) notFound();

  const [suppression, sender, legal] = await withCompany(companyId, () =>
    Promise.all([
      db.emailSuppression.findFirst({ where: { email: normalizeEmail(data.email) } }),
      getEmailDomain(),
      getLegalSettings(),
    ]),
  );
  const company = sender?.fromName || legal.legalName;

  return (
    <LegalPage title={suppression ? "Listo, ya no recibirás estos correos" : "¿Dejar de recibir correos?"}>
      {suppression ? (
        <>
          <p>
            <b>{data.email}</b> no recibirá más correos masivos de {company}. Si nos escribes o eres cliente, igual te
            podemos responder.
          </p>
          {suppression.reason === "UNSUBSCRIBED" && (
            <form action={resubscribeAction}>
              <input type="hidden" name="token" value={token} />
              <SubmitButton variant="secondary" pendingText="Guardando…">
                Me di de baja por error
              </SubmitButton>
            </form>
          )}
        </>
      ) : (
        <>
          <p>
            Vas a dejar de recibir los correos masivos (novedades y promociones) de {company} en <b>{data.email}</b>.
          </p>
          <form action={unsubscribeAction}>
            <input type="hidden" name="token" value={token} />
            <SubmitButton pendingText="Guardando…">Darme de baja</SubmitButton>
          </form>
        </>
      )}
    </LegalPage>
  );
}
