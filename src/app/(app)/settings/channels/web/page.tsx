import { headers } from "next/headers";
import { ExternalLink } from "lucide-react";
import { getChannelSettings } from "@/lib/domain/channels";
import { getWebWidgetSettings } from "@/lib/domain/web-widget";
import { currentCompanyId } from "@/lib/tenant";
import { buttonClass, Field, inputClass, PageHeader } from "@/components/ui";
import { Callout, colorInputClass, FieldGroup, Panel, PanelBody, PanelFooter, Segmented, ToggleRow } from "@/components/settings-ui";
import { CopyField } from "@/components/copy-field";
import { SubmitButton } from "@/components/submit-button";
import { saveWebWidgetAction } from "../../actions";
import { ChannelPageActions } from "../parts";

export default async function WebWidgetPage() {
  const [w, channels, companyId] = await Promise.all([getWebWidgetSettings(), getChannelSettings(), currentCompanyId()]);
  const h = await headers();
  const origin = `https://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const snippet = `<script src="${origin}/widget.js" data-company="${companyId}" async></script>`;

  return (
    <>
      <PageHeader
        title="Widget web"
        description="Una burbuja de chat flotante en tu sitio. Las conversaciones entran como leads al funnel y a Chats, igual que WhatsApp."
      >
        <ChannelPageActions claude={false} />
      </PageHeader>
      <form action={saveWebWidgetAction} className="space-y-6">
        <Panel title="Activar" description="Apagado, el widget no aparece aunque el código esté pegado en el sitio.">
          <PanelBody>
            <ToggleRow name="enabled" defaultChecked={w.enabled} title="Mostrar el chat en mi sitio" />
            <ToggleRow
              name="webAi"
              defaultChecked={channels.webAi}
              title="La asistente responde sola"
              description="Apagado, los mensajes llegan a Chats y el equipo responde desde ahí; los leads nuevos entran con la IA pausada."
            />
          </PanelBody>
        </Panel>

        <Panel title="Apariencia">
          <PanelBody>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Título" hint="Va arriba del chat.">
                <input name="title" defaultValue={w.title} maxLength={60} className={inputClass} />
              </Field>
              <Field label="Color">
                <span className="flex items-center gap-3">
                  <input type="color" name="color" defaultValue={w.color} className={colorInputClass} aria-label="Color del widget" />
                  <span className="text-xs text-slate-600">Botón, encabezado y mensajes del visitante.</span>
                </span>
              </Field>
            </div>
            <Field label="Saludo" hint="El primer mensaje que ve el visitante al abrir el chat. Vacío, no hay saludo.">
              <textarea name="greeting" defaultValue={w.greeting} rows={2} maxLength={300} className={inputClass} />
            </Field>
            <Segmented
              name="position"
              legend="Posición"
              options={[
                ["right", "Abajo a la derecha"],
                ["left", "Abajo a la izquierda"],
              ]}
              defaultValue={w.position}
            />
            <ToggleRow
              name="askContact"
              defaultChecked={w.askContact}
              title="Pedir nombre y teléfono antes de chatear"
              description="Así puedes seguir la conversación por WhatsApp o llamar aunque el visitante se vaya del sitio."
            />
          </PanelBody>
        </Panel>

        <Panel title="Instalación">
          <PanelBody>
            <FieldGroup title="Código para tu sitio" description="Pégalo antes de </body> en todas las páginas donde quieras el chat (o en el pie de página de tu plantilla).">
              <CopyField value={snippet} label="código del widget" block />
            </FieldGroup>
            <Field
              label="Dominios permitidos"
              hint="Uno por línea, por ejemplo miempresa.cl (incluye sus subdominios). Vacío, el chat funciona en cualquier sitio."
            >
              <textarea name="allowedDomains" defaultValue={w.allowedDomains} rows={3} className={`${inputClass} font-mono text-[13px]`} />
            </Field>
            <Callout>
              Los UTM de la página donde el visitante escribe quedan como origen del lead, así ves en Métricas qué campaña trajo
              cada conversación.
            </Callout>
          </PanelBody>
          <PanelFooter
            note={
              w.enabled ? (
                <a href={`/widget-prueba.html?c=${encodeURIComponent(companyId)}`} target="_blank" rel="noopener" className={buttonClass("ghost", "sm", "-ml-3")}>
                  <ExternalLink aria-hidden />
                  Probar el chat
                </a>
              ) : (
                "Activa el chat y guarda para probarlo."
              )
            }
          >
            <SubmitButton toast="Cambios guardados">Guardar</SubmitButton>
          </PanelFooter>
        </Panel>
      </form>
    </>
  );
}
