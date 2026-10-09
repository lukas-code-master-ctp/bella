import { headers } from "next/headers";
import { CircleCheck, CircleDashed } from "lucide-react";
import { missingWhatsAppEnv, WHATSAPP_ENV } from "@/lib/channels/whatsapp";
import { getChannelSettings } from "@/lib/domain/channels";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { saveChannelsAction } from "../actions";

const ENV_HELP: Record<(typeof WHATSAPP_ENV)[number], string> = {
  WHATSAPP_TOKEN: "Token permanente de un usuario del sistema (Business Manager → Usuarios del sistema).",
  WHATSAPP_PHONE_NUMBER_ID: "Identificador del número en la app de Meta (WhatsApp → Configuración de la API).",
  META_APP_SECRET: "Clave secreta de la app (Configuración de la app → Básica).",
  META_VERIFY_TOKEN: "Un texto cualquiera que inventas; se pega igual en Meta al registrar el webhook.",
};

export default async function ChannelsSettingsPage() {
  const s = await getChannelSettings();
  const missing = missingWhatsAppEnv();
  const h = await headers();
  const webhookUrl = `https://${h.get("x-forwarded-host") ?? h.get("host")}/api/webhooks/whatsapp`;

  return (
    <>
      <PageHeader
        title="Canales"
        description="Conecta los canales por donde escriben los leads. Las conversaciones llegan a la misma bandeja y funnel que el simulador."
      />
      <Card className="p-5">
        <CardHeader
          title="WhatsApp"
          description="API oficial de WhatsApp Cloud, directa con Meta."
        >
          {missing.length ? <Badge>Sin conectar</Badge> : <Badge tone="success">Conectado</Badge>}
        </CardHeader>

        <ul className="mt-4 space-y-2 text-sm">
          {WHATSAPP_ENV.map((key) => {
            const ok = !missing.includes(key);
            return (
              <li key={key} className="flex gap-2">
                {ok ? (
                  <CircleCheck aria-label="Configurada" className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                ) : (
                  <CircleDashed aria-label="Falta" className="mt-0.5 size-4 shrink-0 text-slate-400" />
                )}
                <span>
                  <code className="font-mono text-[13px] font-semibold text-slate-900">{key}</code>
                  <span className="block text-xs text-slate-600">{ENV_HELP[key]}</span>
                </span>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-xs text-slate-600">
          Se configuran como variables de entorno en Vercel (Settings → Environment Variables) y se aplican al volver a
          desplegar.
        </p>

        <div className="mt-5 rounded-lg bg-slate-50 p-3 text-sm">
          <p className="font-medium text-slate-800">URL del webhook (en Meta: WhatsApp → Configuración)</p>
          <code className="mt-1 block break-all font-mono text-[13px] text-brand-700">{webhookUrl}</code>
          <p className="mt-1 text-xs text-slate-600">
            Token de verificación: el mismo valor de META_VERIFY_TOKEN. Suscribe el campo <b>messages</b>.
          </p>
        </div>

        <form action={saveChannelsAction} className="mt-5 space-y-3 border-t border-slate-100 pt-4">
          <label className="flex min-h-10 items-center gap-2 text-sm font-medium text-slate-800">
            <input type="checkbox" name="whatsappAi" defaultChecked={s.whatsappAi} className="size-4 rounded border-slate-300 accent-brand-600" />
            La asistente responde sola en WhatsApp
          </label>
          <p className="text-xs text-slate-600">
            Apagado, los mensajes igual llegan a Bella y el equipo responde desde el chat del lead; los leads nuevos
            entran con la IA pausada. Encendido, la asistente contesta y hace los seguimientos (si están activos).
            WhatsApp solo deja escribir libremente hasta 24 horas después del último mensaje del cliente.
          </p>
          <SubmitButton>Guardar</SubmitButton>
        </form>
      </Card>
    </>
  );
}
