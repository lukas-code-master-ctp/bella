import Link from "next/link";
import { ArrowUpRight, Smartphone, SquareKanban } from "lucide-react";
import { missingMessengerEnv } from "@/lib/channels/messenger";
import { missingWhatsAppEnv } from "@/lib/channels/whatsapp";
import { getChannelSettings, MAX_REPLY_DELAY_SECONDS, openLeadsByChannel } from "@/lib/domain/channels";
import { db } from "@/lib/db";
import { credentials } from "@/lib/credentials";
import { pendingDeletionRequests } from "@/lib/domain/privacy";
import { getWebWidgetSettings } from "@/lib/domain/web-widget";
import { listWhatsAppNumbers } from "@/lib/domain/whatsapp-numbers";
import { buttonClass, Card, CardHeader, Field, inputClass, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { saveChannelsAction } from "../actions";
import { AddChannel } from "./add-channel";
import { ChannelIcon, type ChannelKind } from "./channel-icon";
import { ChannelList, type ChannelRow } from "./channel-list";

const checkClass = "size-4 rounded border-slate-300 accent-brand-600";

const DESCRIPTIONS: Record<Exclude<ChannelKind, "SIMULATOR">, string> = {
  WHATSAPP: "API oficial de WhatsApp, con tu número.",
  INSTAGRAM: "Mensajes directos y comentarios de tu cuenta.",
  FACEBOOK: "Mensajes de tu página de Facebook.",
  WEB: "Burbuja de chat flotante en tu sitio web.",
};

export default async function ChannelsSettingsPage() {
  const [s, leads, stages, numbers, env, waMissing, metaMissing, deletions, widget] = await Promise.all([
    getChannelSettings(),
    openLeadsByChannel(),
    db.stage.count(),
    listWhatsAppNumbers(),
    credentials(),
    missingWhatsAppEnv(),
    missingMessengerEnv(),
    pendingDeletionRequests(),
    getWebWidgetSettings(),
  ]);
  const metaOk = metaMissing.length === 0;

  const rows: (ChannelRow & { kind: keyof typeof DESCRIPTIONS })[] = [
    {
      kind: "WHATSAPP",
      group: "WhatsApp",
      name: "WhatsApp",
      detail: env.WHATSAPP_PHONE_NUMBER_ID
        ? `Número ${env.WHATSAPP_PHONE_NUMBER_ID}${numbers.length ? ` y ${numbers.length} más` : ""}`
        : "Sin conectar",
      connected: waMissing.length === 0,
      aiOn: s.whatsappAi,
      setup: "/settings/channels/whatsapp",
    },
    {
      kind: "INSTAGRAM",
      group: "Instagram",
      name: "Instagram",
      detail: !metaOk ? "Sin conectar" : env.META_IG_ACCOUNT_ID ? `Cuenta ${env.META_IG_ACCOUNT_ID}` : "Cuenta vinculada a la página",
      connected: metaOk,
      aiOn: s.instagramAi,
      setup: "/settings/channels/meta",
    },
    {
      kind: "FACEBOOK",
      group: "Messenger",
      name: "Messenger",
      detail: metaOk && env.META_PAGE_ID ? `Página ${env.META_PAGE_ID}` : "Sin conectar",
      connected: metaOk,
      aiOn: s.facebookAi,
      setup: "/settings/channels/meta",
    },
    {
      kind: "WEB",
      group: "Sitio web",
      name: "Widget web",
      detail: widget.enabled ? "Activo en tu sitio" : "Sin activar",
      connected: widget.enabled,
      aiOn: s.webAi,
      setup: "/settings/channels/web",
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
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <Card className="flex flex-col p-5">
          <CardHeader title="Canales conectados" description="Administra tus canales conectados." icon={<Smartphone />} />
          <div className="flex-1">
            <ChannelList rows={rows.filter((r) => r.connected)} />
          </div>
          <AddChannel
            options={rows.map((r) => ({
              kind: r.kind,
              name: r.name,
              description: DESCRIPTIONS[r.kind],
              connected: r.connected,
              href: r.setup,
            }))}
          />
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
              Aún no hay canales conectados. Con &quot;Agregar canal&quot; eliges cuál conectar y ves qué falta.
            </p>
          )}
        </Card>
      </div>

      {deletions.length > 0 && (
        <Link
          href="/settings/channels/meta"
          className="mt-6 block rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-slate-800 hover:bg-amber-100"
        >
          {deletions.length === 1 ? "Hay 1 solicitud" : `Hay ${deletions.length} solicitudes`} de eliminación de datos por revisar en Instagram y Messenger.
        </Link>
      )}

      <div className="mt-6">
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
              ["webAi", "el widget web", s.webAi],
            ] as const
          ).map(([name, label, on]) => (
            <label key={name} className="flex min-h-10 items-center gap-2 text-sm font-medium text-slate-800">
              <input type="checkbox" name={name} defaultChecked={on} className={checkClass} />
              La asistente responde sola en {label}
            </label>
          ))}
          <p className="text-xs text-slate-600">
            Encendido, la asistente contesta y hace los seguimientos (si están activos). En WhatsApp, Instagram y Messenger, Meta solo deja escribir
            libremente hasta 24 horas después del último mensaje del cliente.
          </p>
          <Field
            label="Espera antes de responder (segundos)"
            hint="La asistente responde cuando el cliente lleva este tiempo sin escribir, así contesta varios mensajes seguidos de una vez. 0 responde al instante."
          >
            <input
              name="replyDelaySeconds"
              type="number"
              min={0}
              max={MAX_REPLY_DELAY_SECONDS}
              required
              defaultValue={s.replyDelaySeconds}
              className={`${inputClass} max-w-32`}
            />
          </Field>
          <SubmitButton toast="Cambios guardados">Guardar</SubmitButton>
        </form>
      </Card>
      </div>
    </>
  );
}
