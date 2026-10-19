import { headers } from "next/headers";
import { Suspense } from "react";
import { Trash2 } from "lucide-react";
import { missingWhatsAppEnv, WHATSAPP_ENV } from "@/lib/channels/whatsapp";
import { listFunnels } from "@/lib/domain/funnels";
import { listWhatsAppNumbers } from "@/lib/domain/whatsapp-numbers";
import { signupConfig } from "@/lib/domain/whatsapp-signup";
import { companyUrls } from "@/lib/company-urls";
import { currentCompanyId } from "@/lib/tenant";
import { Badge, Card, CardHeader, inputClass, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { deleteWhatsAppNumberAction, updateWhatsAppNumberAction } from "../../actions";
import { ChannelPageActions, EnvList, ManualSetupHint, Webhook } from "../parts";
import { WhatsAppStatus } from "../whatsapp-status";
import { AddWhatsAppNumberForm, FunnelSelect } from "../whatsapp-numbers";
import { WhatsAppSignup } from "../whatsapp-signup";

export default async function WhatsAppChannelPage() {
  const [numbers, funnels, waMissing] = await Promise.all([listWhatsAppNumbers(), listFunnels(), missingWhatsAppEnv()]);
  const funnelOptions = funnels.map(({ id, name }) => ({ id, name }));
  const h = await headers();
  const origin = `https://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const urls = companyUrls(origin, await currentCompanyId());
  const signup = signupConfig();
  const connected = waMissing.length === 0;

  return (
    <>
      <PageHeader title="WhatsApp" description="API oficial de WhatsApp Cloud, directa con Meta.">
        <ChannelPageActions />
      </PageHeader>
      <div className="space-y-6">
        <Card className="p-5">
          <CardHeader title="Conexión" description="El número donde te escriben los clientes.">
            {connected ? <Badge tone="success">Conectado</Badge> : <Badge>Sin conectar</Badge>}
          </CardHeader>
          {signup && (
            <div className="mb-5 rounded-lg border border-brand-100 bg-brand-50 p-4">
              <p className="text-sm font-semibold text-slate-900">Conexión rápida</p>
              <p className="mb-3 text-xs text-slate-600">
                Inicia sesión con Meta, elige o crea tu número y verifícalo con el código que llega por SMS. Beliapp guarda las
                credenciales y deja el webhook listo. Después agrega un método de pago en WhatsApp Manager para poder
                escribir fuera de las 24 horas.
              </p>
              <WhatsAppSignup config={signup} connected={connected} />
              <p className="mt-3 text-xs text-slate-600">O conéctalo a mano con tu propia app de Meta:</p>
            </div>
          )}
          <ManualSetupHint />
          <EnvList keys={WHATSAPP_ENV} missing={waMissing} />
          <Webhook url={urls.whatsappWebhook} where="WhatsApp → Configuración" fields="el campo messages" />
          {connected && (
            <Suspense
              fallback={<div className="mt-4 h-28 animate-pulse rounded-lg bg-slate-100" aria-label="Revisando la conexión con Meta" />}
            >
              <WhatsAppStatus />
            </Suspense>
          )}
        </Card>

        {connected && (
          <Card className="p-5">
            <CardHeader
              title="Más números de WhatsApp"
              description="Números de la misma cuenta de Meta, que usan el mismo token y webhook. Cada uno puede llevar sus leads nuevos a un embudo, y la asistente responde por el número al que escribió el cliente."
            />
            {numbers.length > 0 && (
              <ul className="mb-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
                {numbers.map((n) => (
                  <li key={n.id} className="flex flex-wrap items-center gap-3 p-3">
                    <form action={updateWhatsAppNumberAction.bind(null, n.id)} className="flex flex-1 flex-wrap items-center gap-2">
                      <span className="w-full text-xs text-slate-600 sm:w-40">
                        <span className="block font-medium text-slate-900">{n.displayPhone ?? n.phoneNumberId}</span>
                        id {n.phoneNumberId}
                      </span>
                      <input name="label" aria-label="Nombre del número" defaultValue={n.label} className={`${inputClass} sm:max-w-48`} />
                      <div className="sm:w-56">
                        <FunnelSelect funnels={funnelOptions} defaultValue={n.funnelId} label={`Embudo de ${n.label}`} />
                      </div>
                      <SubmitButton toast="Cambios guardados" variant="secondary">Guardar</SubmitButton>
                    </form>
                    <form action={deleteWhatsAppNumberAction.bind(null, n.id)}>
                      <SubmitButton toast="Número quitado"
                        variant="ghost-danger"
                        size="icon"
                        aria-label={`Quitar ${n.label}`}
                        confirm={`¿Quitar el número "${n.label}"? Beliapp deja de recibir sus mensajes y sus clientes se responden por el número principal.`}
                        pendingText=""
                      >
                        <Trash2 aria-hidden />
                      </SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <AddWhatsAppNumberForm funnels={funnelOptions} />
          </Card>
        )}
      </div>
    </>
  );
}
