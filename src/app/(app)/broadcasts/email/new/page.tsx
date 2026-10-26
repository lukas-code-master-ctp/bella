import Link from "next/link";
import { ArrowLeft, Globe } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { companyEmailSender, companyResendKey, getEmailDomain } from "@/lib/domain/email-domains";
import { emailNonOpenersCount, suggestedDailyLimit } from "@/lib/domain/email-broadcasts";
import type { EmailBlock } from "@/lib/email-content";
import { listFunnels, stageOptions } from "@/lib/domain/funnels";
import { fileKind } from "@/lib/media";
import { buttonClass, Card, EmptyState, PageHeader } from "@/components/ui";
import { EmailEditor, type EmailResend } from "./email-editor";

/** El envío original, cuando se llega desde "Reenviar a quienes no abrieron". */
async function resendOf(id: string | undefined): Promise<EmailResend | null> {
  if (!id) return null;
  const b = await db.emailBroadcast.findUnique({ where: { id } });
  if (!b) return null;
  return {
    id: b.id,
    name: b.name,
    nonOpeners: await emailNonOpenersCount(b.id),
    content: { subject: b.subject, preheader: b.preheader, color: b.color, footer: b.footer, blocks: b.blocks as EmailBlock[] },
  };
}

export default async function NewEmailBroadcastPage({ searchParams }: { searchParams: Promise<{ reenviar?: string }> }) {
  await requireAdmin();
  const { reenviar } = await searchParams;
  const [sender, domain, funnels, stages, tags, files, dailyLimit, resend, resendKey] = await Promise.all([
    companyEmailSender(),
    getEmailDomain(),
    listFunnels(),
    stageOptions(),
    db.tag.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] }),
    db.mediaFile.findMany({ orderBy: [{ product: "asc" }, { title: "asc" }], select: { url: true, title: true, product: true, mimeType: true } }),
    suggestedDailyLimit(),
    resendOf(reenviar),
    companyResendKey(),
  ]);

  return (
    <>
      <Link href="/broadcasts?canal=correo" className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900">
        <ArrowLeft aria-hidden className="size-4" />
        Envíos masivos
      </Link>
      <PageHeader
        title={resend ? "Reenviar a quienes no abrieron" : "Nuevo correo"}
        description={
          resend
            ? "Partimos del mismo correo: un asunto nuevo suele funcionar mejor. Nada sale hasta que confirmes."
            : "Arma el correo, elige a quiénes y revisa antes de enviar. Nada sale hasta que confirmes."
        }
      />
      {!sender || !resendKey ? (
        <Card className="animate-rise">
          <EmptyState
            icon={<Globe />}
            title={!resendKey ? "Primero conecta tu cuenta de Resend" : domain ? "Tu dominio aún no está verificado" : "Primero conecta tu dominio"}
          >
            Los correos salen con tu cuenta de Resend y desde el dominio de tu empresa. Configúralos en Configuración → Canales → Correo.
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
          resend={resend}
        />
      )}
    </>
  );
}
