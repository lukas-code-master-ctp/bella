import Link from "next/link";
import { ArrowLeft, Globe } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { emailConfigured } from "@/lib/email";
import { companyEmailSender, getEmailDomain } from "@/lib/domain/email-domains";
import { suggestedDailyLimit } from "@/lib/domain/email-broadcasts";
import { listFunnels, stageOptions } from "@/lib/domain/funnels";
import { fileKind } from "@/lib/media";
import { buttonClass, Card, EmptyState, PageHeader } from "@/components/ui";
import { EmailEditor } from "./email-editor";

export default async function NewEmailBroadcastPage() {
  await requireAdmin();
  const [sender, domain, funnels, stages, tags, files, dailyLimit] = await Promise.all([
    companyEmailSender(),
    getEmailDomain(),
    listFunnels(),
    stageOptions(),
    db.tag.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] }),
    db.mediaFile.findMany({ orderBy: [{ product: "asc" }, { title: "asc" }], select: { url: true, title: true, product: true, mimeType: true } }),
    suggestedDailyLimit(),
  ]);

  return (
    <>
      <Link href="/broadcasts?canal=correo" className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900">
        <ArrowLeft aria-hidden className="size-4" />
        Envíos masivos
      </Link>
      <PageHeader title="Nuevo correo" description="Arma el correo, elige a quiénes y revisa antes de enviar. Nada sale hasta que confirmes." />
      {!sender || !emailConfigured() ? (
        <Card className="animate-rise">
          <EmptyState icon={<Globe />} title={domain ? "Tu dominio aún no está verificado" : "Primero conecta tu dominio"}>
            Los correos salen desde el dominio de tu empresa. Conéctalo y agrega los registros DNS en Configuración → Canales → Correo.
            <Link href="/settings/channels/email" className={buttonClass("primary", "md", "mt-4")}>
              Ir a Correo
            </Link>
          </EmptyState>
        </Card>
      ) : (
        <EmailEditor
          funnels={funnels.map((f) => ({ id: f.id, label: f.name }))}
          stages={stages.map((s) => ({ id: s.id, label: s.label, funnelId: s.funnelId }))}
          tags={tags.map((t) => ({ id: t.id, label: `${t.category}: ${t.name}` }))}
          images={files.filter((f) => fileKind(f.mimeType) === "image").map((f) => ({ url: f.url, label: f.product ? `${f.product} · ${f.title}` : f.title }))}
          dailyLimit={dailyLimit}
          sender={sender.from}
          companyName={domain?.fromName ?? ""}
        />
      )}
    </>
  );
}
