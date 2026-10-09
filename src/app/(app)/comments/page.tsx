import Link from "next/link";
import { Check, EyeOff, MessageCircle, MessagesSquare, RotateCcw } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { formatChileDateTime } from "@/lib/domain/follow-ups";
import { canPrivateReply, listComments } from "@/lib/domain/comments";
import { CHANNEL_LABEL } from "@/lib/labels";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { doneCommentAction } from "./actions";
import { CommentReply } from "./comment-reply";

export default async function CommentsPage({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  await requireUser();
  const showDone = (await searchParams).ver === "resueltos";
  const comments = await listComments({ done: showDone });
  const now = new Date();

  return (
    <>
      <PageHeader
        title="Comentarios"
        description="Comentarios nuevos en las publicaciones de Instagram y de la página de Facebook. Respóndelos en público o pásalos a un mensaje privado: si la persona contesta, entra al funnel como lead."
      >
        <nav aria-label="Filtro" className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm font-semibold">
          {[
            ["Pendientes", "/comments", !showDone],
            ["Resueltos", "/comments?ver=resueltos", showDone],
          ].map(([label, href, active]) => (
            <Link
              key={String(label)}
              href={String(href)}
              aria-current={active ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 ${active ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"}`}
            >
              {label}
            </Link>
          ))}
        </nav>
      </PageHeader>

      {comments.length === 0 ? (
        <Card>
          <EmptyState icon={<MessagesSquare />} title={showDone ? "Aún no hay comentarios resueltos" : "No hay comentarios pendientes"}>
            Llegan solos cuando Instagram o Facebook están conectados en Configuración → Canales.
          </EmptyState>
        </Card>
      ) : (
        <ul className="stagger space-y-3">
          {comments.map((c) => (
            <li key={c.id}>
              <Card className="p-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold text-slate-900">{c.authorName}</span>
                  <Badge tone="brand">{CHANNEL_LABEL[c.channel]}</Badge>
                  {c.parentId && <Badge>Respuesta en un hilo</Badge>}
                  {c.hidden && (
                    <Badge tone="warning">
                      <EyeOff aria-hidden />
                      Oculto
                    </Badge>
                  )}
                  <span className="ml-auto text-xs tabular-nums text-slate-600">{formatChileDateTime(c.createdAt)}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{c.text}</p>

                {(c.reply || c.privateReply) && (
                  <div className="mt-3 space-y-1.5 border-l-2 border-brand-200 pl-3 text-sm text-slate-700">
                    {c.reply && (
                      <p>
                        <span className="font-semibold text-slate-900">Respuesta pública:</span> {c.reply}
                      </p>
                    )}
                    {c.privateReply && (
                      <p className="flex gap-1.5">
                        <MessageCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-600" />
                        <span>
                          <span className="font-semibold text-slate-900">Por privado:</span> {c.privateReply}
                        </span>
                      </p>
                    )}
                    {c.repliedBy && <p className="text-xs text-slate-500">Respondió {c.repliedBy.name}</p>}
                  </div>
                )}

                {!showDone && <CommentReply commentId={c.id} canPrivate={canPrivateReply(c, now)} hidden={c.hidden} />}

                <form action={doneCommentAction.bind(null, c.id, !showDone)} className="mt-2">
                  <SubmitButton size="sm" variant="ghost" pendingText="">
                    {showDone ? <RotateCcw aria-hidden /> : <Check aria-hidden />}
                    {showDone ? "Volver a pendientes" : "Marcar como resuelto sin responder"}
                  </SubmitButton>
                </form>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
