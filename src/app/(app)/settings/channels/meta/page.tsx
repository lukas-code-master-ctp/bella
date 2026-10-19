import { headers } from "next/headers";
import { missingMessengerEnv, MESSENGER_ENV } from "@/lib/channels/messenger";
import { getLegalSettings, pendingDeletionRequests } from "@/lib/domain/privacy";
import { formatChileDateTime } from "@/lib/domain/follow-ups";
import { companyUrls } from "@/lib/company-urls";
import { currentCompanyId } from "@/lib/tenant";
import { Badge, Card, CardHeader, Field, inputClass, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { resolveDeletionRequestAction, saveLegalAction } from "../../actions";
import { ChannelPageActions, EnvList, ManualSetupHint, Webhook } from "../parts";

export default async function MetaChannelPage() {
  const [legal, metaMissing, deletions] = await Promise.all([getLegalSettings(), missingMessengerEnv(), pendingDeletionRequests()]);
  const h = await headers();
  const origin = `https://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const urls = companyUrls(origin, await currentCompanyId());

  return (
    <>
      <PageHeader title="Instagram y Messenger" description="Mensajes directos de Instagram y de la página de Facebook, con la app de Meta.">
        <ChannelPageActions />
      </PageHeader>
      <div className="space-y-6">
        <Card className="p-5">
          <CardHeader title="Conexión" description="Una sola app de Meta atiende Instagram y Messenger.">
            {metaMissing.length ? <Badge>Sin conectar</Badge> : <Badge tone="success">Conectado</Badge>}
          </CardHeader>
          <ManualSetupHint />
          <EnvList keys={MESSENGER_ENV} missing={metaMissing} />
          <Webhook
            url={urls.metaWebhook}
            where="Webhooks, para los objetos Page e Instagram"
            fields="messages, messaging_postbacks y comments en Instagram; messages, messaging_postbacks, message_reads y feed en Page"
          />
          <p className="mt-3 text-xs text-slate-600">
            Para atender a cualquier persona (no solo a quienes tienen un rol en la app), Meta debe aprobar en la revisión
            de la app los permisos pages_messaging, instagram_manage_messages, instagram_manage_comments y
            pages_manage_engagement. Los comentarios se responden en Chats → Comentarios.
          </p>
        </Card>

        <Card className="p-5">
          <CardHeader
            title="Revisión de la app de Meta"
            description="Meta pide una política de privacidad pública y una forma de eliminar los datos antes de aprobar Instagram y Messenger. Beliapp las publica con estos datos."
          />
          <dl className="space-y-3 text-sm">
            {[
              ["Política de privacidad (Configuración de la app → Básica)", urls.privacy],
              ["URL de devolución de llamada de eliminación de datos", urls.dataDeletionCallback],
            ].map(([label, url]) => (
              <div key={url} className="rounded-lg bg-slate-50 p-3">
                <dt className="font-medium text-slate-800">{label}</dt>
                <dd>
                  <code className="mt-1 block break-all font-mono text-[13px] text-brand-700">{url}</code>
                </dd>
              </div>
            ))}
          </dl>
          <form action={saveLegalAction} className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Empresa responsable de los datos" hint="Razón social o nombre comercial.">
              <input name="legalName" required defaultValue={legal.legalName} className={inputClass} />
            </Field>
            <Field label="Correo para temas de privacidad" hint="Aparece en la política para pedir acceso o borrado.">
              <input name="contactEmail" type="email" required defaultValue={legal.contactEmail} className={inputClass} />
            </Field>
            <div>
              <SubmitButton toast="Cambios guardados">Guardar</SubmitButton>
            </div>
          </form>
          {deletions.length > 0 && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-slate-800">
              <p className="font-medium">Solicitudes de eliminación por revisar</p>
              <p className="mt-1 text-xs text-slate-600">
                Meta no entregó un id que calce con un contacto. Busca a la persona en Chats (por fecha o si escribió
                al correo de privacidad con el código), elimina su contacto y marca la solicitud como revisada.
              </p>
              <ul className="mt-2 space-y-2">
                {deletions.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <b>{d.code}</b> · {formatChileDateTime(d.createdAt)}
                    </span>
                    <form action={resolveDeletionRequestAction.bind(null, d.id)}>
                      <SubmitButton variant="secondary">Marcar revisada</SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
