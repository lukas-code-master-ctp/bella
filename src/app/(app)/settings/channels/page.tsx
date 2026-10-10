import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowUpRight, CircleCheck, CircleDashed, Plus, Smartphone, Sparkles, SquareKanban } from "lucide-react";
import { missingMessengerEnv, MESSENGER_ENV } from "@/lib/channels/messenger";
import { missingWhatsAppEnv, WHATSAPP_ENV } from "@/lib/channels/whatsapp";
import { getChannelSettings, openLeadsByChannel } from "@/lib/domain/channels";
import { db } from "@/lib/db";
import { getLegalSettings } from "@/lib/domain/privacy";
import { Badge, buttonClass, Card, CardHeader, Field, inputClass, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { saveChannelsAction, saveLegalAction } from "../actions";
import { ChannelIcon } from "./channel-icon";
import { ChannelList, type ChannelRow } from "./channel-list";
import { WhatsAppStatus } from "./whatsapp-status";

const ENV_HELP: Record<string, string> = {
  WHATSAPP_TOKEN: "Token permanente de un usuario del sistema (Business Manager → Usuarios del sistema).",
  WHATSAPP_PHONE_NUMBER_ID: "Identificador del número en la app de Meta (WhatsApp → Configuración de la API).",
  META_PAGE_ACCESS_TOKEN: "Token permanente de la página de Facebook, generado con un usuario del sistema.",
  META_PAGE_ID: "Id de la página de Facebook. La cuenta profesional de Instagram debe estar vinculada a ella.",
  META_APP_SECRET: "Clave secreta de la app (Configuración de la app → Básica).",
  META_VERIFY_TOKEN: "Un texto cualquiera que inventas; se pega igual en Meta al registrar el webhook.",
};

const checkClass = "size-4 rounded border-slate-300 accent-brand-600";

function EnvList({ keys, missing }: { keys: readonly string[]; missing: string[] }) {
  return (
    <ul className="space-y-2 text-sm">
      {keys.map((key) => (
        <li key={key} className="flex gap-2">
          {missing.includes(key) ? (
            <CircleDashed aria-label="Falta" className="mt-0.5 size-4 shrink-0 text-slate-400" />
          ) : (
            <CircleCheck aria-label="Configurada" className="mt-0.5 size-4 shrink-0 text-emerald-600" />
          )}
          <span>
            <code className="font-mono text-[13px] font-semibold text-slate-900">{key}</code>
            <span className="block text-xs text-slate-600">{ENV_HELP[key]}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Webhook({ url, where, fields }: { url: string; where: string; fields: string }) {
  return (
    <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
      <p className="font-medium text-slate-800">URL del webhook (en Meta: {where})</p>
      <code className="mt-1 block break-all font-mono text-[13px] text-brand-700">{url}</code>
      <p className="mt-1 text-xs text-slate-600">
        Token de verificación: el mismo valor de META_VERIFY_TOKEN. Suscribe {fields}.
      </p>
    </div>
  );
}

export default async function ChannelsSettingsPage() {
  const [s, legal, leads, stages] = await Promise.all([
    getChannelSettings(),
    getLegalSettings(),
    openLeadsByChannel(),
    db.stage.count(),
  ]);
  const waMissing = missingWhatsAppEnv();
  const metaMissing = missingMessengerEnv();
  const h = await headers();
  const origin = `https://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const base = `${origin}/api/webhooks`;
  const env = process.env;
  const metaOk = metaMissing.length === 0;

  const rows: ChannelRow[] = [
    {
      kind: "WHATSAPP",
      group: "WhatsApp",
      name: "WhatsApp",
      detail: env.WHATSAPP_PHONE_NUMBER_ID ? `Número ${env.WHATSAPP_PHONE_NUMBER_ID}` : "Sin conectar",
      connected: waMissing.length === 0,
      aiOn: s.whatsappAi,
      setup: "#whatsapp",
    },
    {
      kind: "INSTAGRAM",
      group: "Instagram",
      name: "Instagram",
      detail: !metaOk ? "Sin conectar" : env.META_IG_ACCOUNT_ID ? `Cuenta ${env.META_IG_ACCOUNT_ID}` : "Cuenta vinculada a la página",
      connected: metaOk,
      aiOn: s.instagramAi,
      setup: "#meta",
    },
    {
      kind: "FACEBOOK",
      group: "Messenger",
      name: "Messenger",
      detail: metaOk && env.META_PAGE_ID ? `Página ${env.META_PAGE_ID}` : "Sin conectar",
      connected: metaOk,
      aiOn: s.facebookAi,
      setup: "#meta",
    },
  ];
  const inFunnel = [
    ...rows.filter((r) => r.connected),
    { kind: "SIMULATOR" as const, name: "Simulador", detail: "Pruebas de la asistente" },
  ];

  return (
    <>
      <PageHeader
        title="Canales"
        description="Conecta los canales por donde escriben los leads. Las conversaciones llegan al mismo funnel y chat que el simulador."
      >
        <Link href="/settings/claude" className={buttonClass("secondary")}>
          <Sparkles aria-hidden />
          Configurar con Claude
        </Link>
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <Card className="flex flex-col p-5">
          <CardHeader title="Canales conectados" description="Administra tus canales conectados." icon={<Smartphone />} />
          <div className="flex-1">
            <ChannelList rows={rows} />
          </div>
          <a href="#configurar" className={buttonClass("primary", "md", "mt-5 w-full")}>
            <Plus aria-hidden />
            Agregar canal
          </a>
        </Card>

        <Card className="self-start p-5">
          <CardHeader
            title="Canales en tu funnel"
            description="Las conversaciones de cada canal entran como leads al funnel de ventas."
            icon={<SquareKanban />}
          />
          <div className="rounded-xl border border-slate-100 bg-slate-50">
            <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900">Funnel de ventas</p>
                <p className="text-xs text-slate-600">
                  {stages} {stages === 1 ? "etapa" : "etapas"} · {inFunnel.length} {inFunnel.length === 1 ? "canal asociado" : "canales asociados"}
                </p>
              </div>
              <Link href="/settings/funnel" className={buttonClass("secondary", "sm")}>
                Etapas
              </Link>
              <Link href="/funnel" className={buttonClass("primary", "sm")}>
                <ArrowUpRight aria-hidden />
                Ir al funnel
              </Link>
            </div>
            <ul className="grid gap-3 p-4 sm:grid-cols-2">
              {inFunnel.map((c) => (
                <li key={c.kind} className="rounded-lg border border-slate-200 bg-white p-3 shadow-xs">
                  <ChannelIcon kind={c.kind} />
                  <p className="mt-2 truncate text-sm font-semibold text-slate-900">{c.name}</p>
                  <p className="truncate text-xs text-slate-600">{c.detail}</p>
                  <p className="mt-2 text-xs font-medium text-brand-700">
                    {leads[c.kind]} {leads[c.kind] === 1 ? "lead abierto" : "leads abiertos"}
                  </p>
                </li>
              ))}
            </ul>
          </div>
          {inFunnel.length === 1 && (
            <p className="mt-3 text-xs text-slate-600">
              Aún no hay canales de Meta conectados. Con &quot;Agregar canal&quot; ves qué falta para conectar WhatsApp, Instagram o Messenger.
            </p>
          )}
        </Card>
      </div>

      <h2 id="configurar" className="mb-1 mt-10 scroll-mt-6 text-lg font-semibold text-slate-900">
        Agregar o configurar un canal
      </h2>
      <p className="mb-4 text-sm text-slate-600">
        Bella se conecta directo con Meta. Carga estas variables en Vercel y registra el webhook en la app de Meta.
      </p>
      <div className="space-y-6">
        <Card id="whatsapp" className="scroll-mt-6 p-5">
          <CardHeader title="WhatsApp" description="API oficial de WhatsApp Cloud, directa con Meta.">
            {waMissing.length ? <Badge>Sin conectar</Badge> : <Badge tone="success">Conectado</Badge>}
          </CardHeader>
          <EnvList keys={WHATSAPP_ENV} missing={waMissing} />
          <Webhook url={`${base}/whatsapp`} where="WhatsApp → Configuración" fields="el campo messages" />
          {waMissing.length === 0 && (
            <Suspense
              fallback={<div className="mt-4 h-28 animate-pulse rounded-lg bg-slate-100" aria-label="Revisando la conexión con Meta" />}
            >
              <WhatsAppStatus />
            </Suspense>
          )}
        </Card>

        <Card id="meta" className="scroll-mt-6 p-5">
          <CardHeader
            title="Instagram y Facebook Messenger"
            description="Mensajes directos de Instagram y de la página de Facebook, con la app de Meta."
          >
            {metaMissing.length ? <Badge>Sin conectar</Badge> : <Badge tone="success">Conectado</Badge>}
          </CardHeader>
          <EnvList keys={MESSENGER_ENV} missing={metaMissing} />
          <Webhook
            url={`${base}/meta`}
            where="Webhooks, para los objetos Page e Instagram"
            fields="messages, messaging_postbacks y comments en Instagram; messages, messaging_postbacks, message_reads y feed en Page"
          />
          <p className="mt-3 text-xs text-slate-600">
            Para atender a cualquier persona (no solo a quienes tienen un rol en la app), Meta debe aprobar en la revisión
            de la app los permisos pages_messaging, instagram_manage_messages, instagram_manage_comments y
            pages_manage_engagement. Los comentarios se responden en la pestaña Comentarios.
          </p>
        </Card>

        <Card className="p-5">
          <CardHeader
            title="Revisión de la app de Meta"
            description="Meta pide una política de privacidad pública y una forma de eliminar los datos antes de aprobar Instagram y Messenger. Bella las publica con estos datos."
          />
          <dl className="space-y-3 text-sm">
            {[
              ["Política de privacidad (Configuración de la app → Básica)", `${origin}/privacidad`],
              ["URL de devolución de llamada de eliminación de datos", `${base}/meta/data-deletion`],
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
              <SubmitButton>Guardar</SubmitButton>
            </div>
          </form>
        </Card>

        <Card className="p-5">
          <CardHeader
            title="Respuestas de la asistente"
            description="Por canal, si la asistente contesta sola. Apagado, los mensajes igual llegan y el equipo responde desde el chat del lead; los leads nuevos entran con la IA pausada."
          />
          <form action={saveChannelsAction} className="space-y-3">
            {(
              [
                ["whatsappAi", "WhatsApp", s.whatsappAi],
                ["instagramAi", "Instagram", s.instagramAi],
                ["facebookAi", "Facebook Messenger", s.facebookAi],
              ] as const
            ).map(([name, label, on]) => (
              <label key={name} className="flex min-h-10 items-center gap-2 text-sm font-medium text-slate-800">
                <input type="checkbox" name={name} defaultChecked={on} className={checkClass} />
                La asistente responde sola en {label}
              </label>
            ))}
            <p className="text-xs text-slate-600">
              Encendido, la asistente contesta y hace los seguimientos (si están activos). Meta solo deja escribir
              libremente hasta 24 horas después del último mensaje del cliente.
            </p>
            <SubmitButton>Guardar</SubmitButton>
          </form>
        </Card>
      </div>
    </>
  );
}
