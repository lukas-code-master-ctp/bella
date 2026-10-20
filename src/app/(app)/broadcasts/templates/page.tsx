import Link from "next/link";
import { ArrowLeft, FileText, Image as ImageIcon, MessageSquareText, Send, Video } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { messageTemplates, missingWhatsAppEnv, type ApprovedTemplate } from "@/lib/channels/whatsapp";
import { Callout } from "@/components/settings-ui";
import { Badge, buttonClass, Card, EmptyState, PageHeader } from "@/components/ui";
import { DeleteTemplateButton, NewTemplate } from "./templates-ui";

const STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" }> = {
  APPROVED: { label: "Aprobada", tone: "success" },
  PENDING: { label: "En revisión", tone: "warning" },
  IN_APPEAL: { label: "En apelación", tone: "warning" },
  REJECTED: { label: "Rechazada", tone: "danger" },
};

const CATEGORY: Record<string, string> = { MARKETING: "Marketing", UTILITY: "Aviso", AUTHENTICATION: "Código de acceso" };

const LANGUAGE: Record<string, string> = {
  es: "Español",
  es_CL: "Español (Chile)",
  es_MX: "Español (México)",
  es_AR: "Español (Argentina)",
  es_ES: "Español (España)",
  en: "Inglés",
  en_US: "Inglés (EE. UU.)",
  pt_BR: "Portugués (Brasil)",
};

const HEADER_ICON = { image: ImageIcon, video: Video, document: FileText } as const;
const HEADER_LABEL = { image: "Imagen", video: "Video", document: "Documento" } as const;

/** Las variables {{1}}, {{2}}… resaltadas, para ver qué se llena al enviar. */
function BodyText({ text }: { text: string }) {
  return text.split(/(\{\{\s*[^}]+\s*\}\})/g).map((part, i) =>
    i % 2 ? (
      <span key={i} className="rounded bg-brand-100 px-1 font-medium text-brand-800">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/** Cómo la ve la persona en WhatsApp. */
function Preview({ t }: { t: ApprovedTemplate }) {
  const Icon = t.header ? HEADER_ICON[t.header as keyof typeof HEADER_ICON] : null;
  return (
    <div className="rounded-lg bg-[#efeae2] p-3">
      <div className="max-w-sm rounded-lg rounded-tl-none bg-white text-sm text-slate-800 shadow-xs">
        {Icon && (
          <div className="flex h-24 items-center justify-center gap-2 rounded-t-lg bg-slate-100 text-xs text-slate-500">
            <Icon aria-hidden className="size-5" />
            {HEADER_LABEL[t.header as keyof typeof HEADER_LABEL]} al enviar
          </div>
        )}
        <div className="space-y-1 px-3 py-2">
          {t.headerText && <p className="font-semibold">{t.headerText}</p>}
          <p className="whitespace-pre-wrap break-words">{t.body ? <BodyText text={t.body} /> : <span className="text-slate-400">Sin texto</span>}</p>
          {t.footer && <p className="text-xs text-slate-500">{t.footer}</p>}
        </div>
        {(t.buttons ?? []).map((b, i) => (
          <div key={i} className="border-t border-slate-100 py-2 text-center text-sm font-medium text-sky-600">
            {b}
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function TemplatesPage() {
  await requireAdmin();
  const missing = await missingWhatsAppEnv();
  let templates: ApprovedTemplate[] = [];
  let error: string | null = missing.length ? "Falta conectar WhatsApp en Configuración → Canales." : null;
  if (!error) {
    try {
      templates = await messageTemplates();
    } catch (e) {
      error = e instanceof Error ? e.message : "No se pudo consultar a Meta.";
    }
  }

  return (
    <>
      <Link href="/broadcasts" className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900">
        <ArrowLeft aria-hidden className="size-4" />
        Envíos masivos
      </Link>
      <PageHeader
        title="Plantillas de WhatsApp"
        description="Los mensajes aprobados por Meta que puedes usar en envíos masivos y seguimientos. Meta revisa cada plantilla nueva antes de poder usarla."
      >
        {!error && <NewTemplate />}
      </PageHeader>

      {error ? (
        <Callout tone="danger" title="No se pudieron leer las plantillas de Meta">
          {error}
        </Callout>
      ) : templates.length === 0 ? (
        <Card className="animate-rise">
          <EmptyState icon={<MessageSquareText />} title="Aún no hay plantillas">
            Crea la primera con “Nueva plantilla”. Meta suele aprobarlas en minutos u horas.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid animate-rise gap-4 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((t) => {
            const status = STATUS[t.status] ?? { label: t.status, tone: "warning" as const };
            const usable = t.status === "APPROVED" && !t.unsupported;
            return (
              <Card key={`${t.name}|${t.language}`} className="flex flex-col gap-3 p-4">
                <div className="min-w-0">
                  <h2 className="break-words font-semibold text-slate-900">{t.name}</h2>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Badge tone={status.tone}>{status.label}</Badge>
                    {t.category && <Badge>{CATEGORY[t.category] ?? t.category}</Badge>}
                    <Badge>{LANGUAGE[t.language] ?? t.language}</Badge>
                  </div>
                </div>
                <Preview t={t} />
                {t.reason && <p className="text-xs text-rose-700">Motivo del rechazo: {t.reason}</p>}
                {t.status === "APPROVED" && t.unsupported && <p className="text-xs text-amber-800">{t.unsupported}</p>}
                <div className="mt-auto flex flex-wrap items-center justify-end gap-2 pt-1">
                  {t.id && <DeleteTemplateButton id={t.id} name={t.name} />}
                  {usable && (
                    <Link
                      href={`/broadcasts/new?plantilla=${encodeURIComponent(`${t.name}|${t.language}`)}`}
                      className={buttonClass("secondary", "sm")}
                    >
                      <Send aria-hidden />
                      Usar en un envío
                    </Link>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
