import { headers } from "next/headers";
import { Code2, Link2, Megaphone } from "lucide-react";
import { adsToken } from "@/lib/channels/ads";
import { companyUrls, withParams } from "@/lib/company-urls";
import { credentials } from "@/lib/credentials";
import { currentCompanyId } from "@/lib/tenant";
import { getAttributionSettings } from "@/lib/domain/attribution";
import { Field, inputClass, PageHeader } from "@/components/ui";
import { EnvChecklist, FieldGroup, Panel, PanelBody, PanelFooter, StatusPill } from "@/components/settings-ui";
import { CopyField } from "@/components/copy-field";
import { SubmitButton } from "@/components/submit-button";
import { saveAttributionAction } from "../actions";

export default async function AttributionSettingsPage() {
  const s = await getAttributionSettings();
  const h = await headers();
  const origin = `https://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const example = withParams(companyUrls(origin, await currentCompanyId()).wa, `utm_source=google&utm_medium=cpc&utm_campaign=campana-octubre&text=${encodeURIComponent("Hola, quiero información")}`);
  const creds = await credentials();
  const hasAdsToken = Boolean(creds.META_ADS_TOKEN);
  const fallbackToken = Boolean(await adsToken());
  const snippet = `<script>
document.querySelectorAll('a[href^="${origin}/wa"]').forEach(function (a) {
  var url = new URL(a.href);
  new URLSearchParams(location.search).forEach(function (v, k) {
    if (k.indexOf("utm_") === 0) url.searchParams.set(k, v);
  });
  a.href = url.toString();
});
</script>`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Origen de leads"
        description="De qué anuncio, campaña o landing viene cada lead. Se ve en la ficha del lead y se usa en las métricas."
      />
      <Panel
        icon={<Megaphone />}
        title="Anuncios de Meta"
        description="Cuando alguien escribe desde un anuncio de clic a WhatsApp, Instagram o Messenger, Meta manda el anuncio en el primer mensaje y Beliapp lo guarda solo."
        aside={<StatusPill on onLabel="Automático" />}
      >
        <PanelBody>
          <EnvChecklist
            items={[
              [
                "Token de anuncios (en Credenciales)",
                hasAdsToken,
                <>
                  Opcional. Token de un usuario del sistema con permiso ads_read sobre la cuenta publicitaria, para ver el
                  nombre de la campaña y del conjunto de anuncios.
                  {!hasAdsToken && fallbackToken && " Mientras no esté, Beliapp prueba con el token de WhatsApp o de la página."}
                </>,
              ],
            ]}
          />
        </PanelBody>
      </Panel>

      <Panel
        icon={<Link2 />}
        title="Landings y formularios"
        description="El botón de WhatsApp de la landing apunta a este enlace con sus UTM. Beliapp los guarda y abre WhatsApp con un código corto al final del mensaje; cuando el mensaje llega, el lead queda con esos UTM."
      >
        <form action={saveAttributionAction}>
          <PanelBody>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Número de WhatsApp" hint="Con código de país, ej. 56912345678.">
                <input name="whatsappNumber" inputMode="tel" defaultValue={s.whatsappNumber} placeholder="56912345678" className={inputClass} />
              </Field>
              <Field label="Mensaje prellenado" hint="Si el enlace no trae su propio text.">
                <input name="defaultText" defaultValue={s.defaultText} className={inputClass} />
              </Field>
            </div>
          </PanelBody>
          <PanelFooter>
            <SubmitButton>Guardar</SubmitButton>
          </PanelFooter>
        </form>
        <PanelBody className="border-t border-slate-100">
          <FieldGroup
            title="Enlace para el botón de la landing"
            description="Cambia los utm_ por los de cada campaña; text es opcional. El código queda fuera del mensaje que ven el equipo y la IA."
          >
            <CopyField value={example} label="el enlace" />
          </FieldGroup>
        </PanelBody>
      </Panel>

      <Panel
        icon={<Code2 />}
        title="Opcional: pasar los UTM de la landing al botón"
        description="Pega esto al final de la landing y los botones que apuntan a /wa toman los UTM con que llegó la visita."
      >
        <PanelBody>
          <CopyField value={snippet} label="el código" block />
        </PanelBody>
      </Panel>
    </div>
  );
}
