import { headers } from "next/headers";
import { CircleCheck, CircleDashed } from "lucide-react";
import { adsToken } from "@/lib/channels/ads";
import { getAttributionSettings } from "@/lib/domain/attribution";
import { Badge, Card, CardHeader, Field, inputClass, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { saveAttributionAction } from "../actions";

export default async function AttributionSettingsPage() {
  const s = await getAttributionSettings();
  const h = await headers();
  const origin = `https://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const example = `${origin}/wa?utm_source=google&utm_medium=cpc&utm_campaign=parcelas-sur&text=${encodeURIComponent("Hola, quiero información")}`;
  const hasAdsToken = Boolean(process.env.META_ADS_TOKEN);
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
    <>
      <PageHeader
        title="Origen de leads"
        description="De qué anuncio, campaña o landing viene cada lead. Se ve en la ficha del lead y se usa en las métricas."
      />
      <div className="space-y-6">
        <Card className="p-5">
          <CardHeader
            title="Anuncios de Meta"
            description="Cuando alguien escribe desde un anuncio de clic a WhatsApp, Instagram o Messenger, Meta manda el anuncio en el primer mensaje y Bella lo guarda solo."
          >
            <Badge tone="success">Automático</Badge>
          </CardHeader>
          <div className="flex gap-2 text-sm">
            {hasAdsToken ? (
              <CircleCheck aria-label="Configurada" className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            ) : (
              <CircleDashed aria-label="Falta" className="mt-0.5 size-4 shrink-0 text-slate-400" />
            )}
            <span>
              <code className="font-mono text-[13px] font-semibold text-slate-900">META_ADS_TOKEN</code>
              <span className="block text-xs text-slate-600">
                Opcional. Token de un usuario del sistema con permiso ads_read sobre la cuenta publicitaria, para ver el
                nombre de la campaña y del conjunto de anuncios.
                {!hasAdsToken && adsToken() && " Mientras no esté, Bella prueba con el token de WhatsApp o de la página."}
              </span>
            </span>
          </div>
        </Card>

        <Card className="p-5">
          <CardHeader
            title="Landings y formularios"
            description="El botón de WhatsApp de la landing apunta a este enlace con sus UTM. Bella los guarda y abre WhatsApp con un código corto al final del mensaje; cuando el mensaje llega, el lead queda con esos UTM."
          />
          <form action={saveAttributionAction} className="grid gap-4 sm:grid-cols-2">
            <Field label="Número de WhatsApp" hint="Con código de país, ej. 56912345678.">
              <input
                name="whatsappNumber"
                inputMode="tel"
                defaultValue={s.whatsappNumber}
                placeholder="56912345678"
                className={inputClass}
              />
            </Field>
            <Field label="Mensaje prellenado" hint="Si el enlace no trae su propio text.">
              <input name="defaultText" defaultValue={s.defaultText} className={inputClass} />
            </Field>
            <div>
              <SubmitButton>Guardar</SubmitButton>
            </div>
          </form>
          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
            <p className="font-medium text-slate-800">Enlace para el botón de la landing</p>
            <code className="mt-1 block break-all font-mono text-[13px] text-brand-700">{example}</code>
            <p className="mt-1 text-xs text-slate-600">
              Cambia los utm_ por los de cada campaña; text es opcional. El código queda fuera del mensaje que ven el equipo y
              la IA.
            </p>
          </div>
          <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
            <p className="font-medium text-slate-800">Opcional: pasar los UTM de la landing al botón</p>
            <p className="mt-0.5 text-xs text-slate-600">
              Pega esto al final de la landing y los botones que apuntan a /wa toman los UTM con que llegó la visita.
            </p>
            <pre className="mt-2 overflow-x-auto font-mono text-[12px] leading-relaxed text-slate-800">{snippet}</pre>
          </div>
        </Card>
      </div>
    </>
  );
}
