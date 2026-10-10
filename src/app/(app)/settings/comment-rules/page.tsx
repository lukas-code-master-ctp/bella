import { ExternalLink, MessageSquareReply, Trash2 } from "lucide-react";
import { recentPosts, type SocialPost } from "@/lib/channels/comments";
import { ChannelSendError } from "@/lib/channels/whatsapp";
import { listCommentRules } from "@/lib/domain/comment-rules";
import { CHANNEL_LABEL } from "@/lib/labels";
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { deleteCommentRuleAction, toggleCommentRuleAction } from "./actions";
import { CommentRuleForm } from "./form";

async function loadPosts(): Promise<{ posts: SocialPost[]; error: string | null }> {
  if (!process.env.META_PAGE_ACCESS_TOKEN) {
    return { posts: [], error: "Conecta Instagram o Facebook en Canales para elegir la publicación de una lista." };
  }
  try {
    return { posts: await recentPosts(), error: null };
  } catch (e) {
    return { posts: [], error: e instanceof ChannelSendError ? `No se pudieron cargar las publicaciones: ${e.message}` : "No se pudieron cargar las publicaciones." };
  }
}

export default async function CommentRulesPage() {
  const [rules, { posts, error }] = await Promise.all([listCommentRules(), loadPosts()]);

  return (
    <>
      <PageHeader
        title="Reglas de comentarios"
        description="Responden solas a los comentarios nuevos de una publicación (o de todas) que contengan ciertas palabras: en público, por mensaje privado, y pueden ocultar o borrar el comentario. Si hay varias que coinciden, gana la más específica: primero las de una publicación, luego las con palabras clave. Solo actúan sobre comentarios nuevos de primer nivel, no sobre respuestas dentro de un hilo."
      />
      <Card className="mb-6 divide-y divide-slate-100">
        {rules.length === 0 && (
          <EmptyState icon={<MessageSquareReply />} title="Aún no hay reglas">
            Crea la primera con el formulario de abajo. Las reglas nuevas quedan inactivas hasta que las actives.
          </EmptyState>
        )}
        {rules.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 p-4 text-sm">
            <div className={`min-w-0 flex-1 ${r.active ? "" : "opacity-60"}`}>
              <div className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
                {r.name}
                {r.active ? <Badge tone="success">Activa</Badge> : <Badge>Inactiva</Badge>}
                <span className="text-xs font-normal text-slate-600">
                  {r._count.comments === 1 ? "1 comentario atendido" : `${r._count.comments} comentarios atendidos`}
                </span>
              </div>
              <div className="mt-0.5 text-slate-600">
                {r.channel ? CHANNEL_LABEL[r.channel] : "Instagram y Facebook"} ·{" "}
                {r.postId ? (
                  <>
                    publicación{" "}
                    <span className="font-medium text-slate-800">{r.postLabel ?? r.postId}</span>
                    {(() => {
                      const url = posts.find((p) => p.id === r.postId)?.url;
                      return url ? (
                        <a href={url} target="_blank" rel="noreferrer" className="ml-1 inline-flex align-middle text-brand-700" aria-label="Ver publicación">
                          <ExternalLink aria-hidden className="size-3.5" />
                        </a>
                      ) : null;
                    })()}
                  </>
                ) : (
                  "todas las publicaciones"
                )}{" "}
                · {r.keywords.length ? `contiene "${r.keywords.join('", "')}"` : "cualquier comentario"}
              </div>
              <ul className="mt-1.5 space-y-0.5 text-slate-700">
                {r.publicReply && <li>Responde en público: “{r.publicReply}”</li>}
                {r.privateReply && <li>Escribe por privado: “{r.privateReply}”</li>}
                {r.hide && <li>Oculta el comentario</li>}
                {r.remove && <li>Borra el comentario</li>}
              </ul>
            </div>
            <form action={toggleCommentRuleAction.bind(null, r.id, !r.active)}>
              <Button variant="secondary">{r.active ? "Desactivar" : "Activar"}</Button>
            </form>
            <form action={deleteCommentRuleAction.bind(null, r.id)}>
              <SubmitButton variant="ghost-danger" size="icon" aria-label={`Borrar regla ${r.name}`} title="Borrar regla" confirm={`¿Borrar la regla "${r.name}"?`} pendingText="">
                <Trash2 aria-hidden />
              </SubmitButton>
            </form>
          </div>
        ))}
      </Card>

      <Card className="p-5">
        <CardHeader title="Nueva regla" description="Meta permite un solo mensaje privado por comentario, dentro de 7 días." />
        <CommentRuleForm posts={posts} postsError={error} />
      </Card>
    </>
  );
}
