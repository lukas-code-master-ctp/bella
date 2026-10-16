import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { credential } from "@/lib/credentials";
import { messageTemplates, messagingLimit, missingWhatsAppEnv, type ApprovedTemplate } from "@/lib/channels/whatsapp";
import { getChannelSettings } from "@/lib/domain/channels";
import { listFunnels, stageOptions } from "@/lib/domain/funnels";
import { listWhatsAppNumbers } from "@/lib/domain/whatsapp-numbers";
import { PageHeader } from "@/components/ui";
import { BroadcastWizard } from "./wizard";

/** Si Meta no se puede consultar (sin token, sin cuenta), el asistente lo explica en el paso 2. */
async function safely<T>(fn: () => Promise<T>): Promise<{ value: T } | { error: string }> {
  try {
    return { value: await fn() };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo consultar a Meta." };
  }
}

export default async function NewBroadcastPage() {
  await requireAdmin();
  const missing = await missingWhatsAppEnv();
  const [templates, limit, funnels, stages, tags, numbers, mainNumber, channels] = await Promise.all([
    missing.length ? { error: "Falta conectar WhatsApp en Configuración → Canales." } : safely(messageTemplates),
    missing.length ? null : safely(() => messagingLimit()),
    listFunnels(),
    stageOptions(),
    db.tag.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] }),
    listWhatsAppNumbers(),
    credential("WHATSAPP_PHONE_NUMBER_ID"),
    getChannelSettings(),
  ]);
  const dailyLimit = limit && "value" in limit && limit.value ? limit.value : 250;

  return (
    <>
      <Link href="/broadcasts" className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900">
        <ArrowLeft aria-hidden className="size-4" />
        Envíos masivos
      </Link>
      <PageHeader title="Nuevo envío" description="Elige a quiénes, la plantilla y revisa antes de enviar. Nada sale hasta que confirmes en el último paso." />
      <BroadcastWizard
        templates={"value" in templates ? (templates.value as ApprovedTemplate[]) : []}
        templatesError={"error" in templates ? templates.error : null}
        funnels={funnels.map((f) => ({ id: f.id, label: f.name }))}
        stages={stages.map((s) => ({ id: s.id, label: s.label, funnelId: s.funnelId }))}
        tags={tags.map((t) => ({ id: t.id, label: `${t.category}: ${t.name}` }))}
        numbers={[
          ...(mainNumber ? [{ id: "", label: "Número principal" }] : []),
          ...numbers.map((n) => ({ id: n.phoneNumberId, label: `${n.label}${n.displayPhone ? ` (${n.displayPhone})` : ""}` })),
        ]}
        dailyLimit={dailyLimit}
        dailyLimitKnown={Boolean(limit && "value" in limit && limit.value)}
        aiOn={channels.whatsappAi}
      />
    </>
  );
}
