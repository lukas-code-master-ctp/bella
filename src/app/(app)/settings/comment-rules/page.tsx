import { ExternalLink, EyeOff, Lock, MessageSquareReply, Plus, Trash2, Globe } from "lucide-react";
import { recentPosts, type SocialPost } from "@/lib/channels/comments";
import { ChannelSendError } from "@/lib/channels/whatsapp";
import { listCommentRules } from "@/lib/domain/comment-rules";
import { CHANNEL_LABEL } from "@/lib/labels";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { Callout, Panel, SwitchSubmit } from "@/components/settings-ui";
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
    <div className="space-y-6">
      <PageHeader
        title="Reglas de comentarios"
        description="Responden solas a los comentarios nuevos de una publicación (o de todas) que contengan ciertas palabras: en público, por mensaje privado, y pueden ocultar o borrar el comentario."
      />
      <Callout tone="neutral">
        Si hay varias que coinciden, gana la más específica: primero las de una publicación, luego las con palabras clave.
        Solo actúan sobre comentarios nuevos de primer nivel, no sobre respuestas dentro de un hilo.
      </Callout>

      {rules.length === 0 ? (
        <Card className="animate-rise">
          <EmptyState icon={<MessageSquareReply />} title="Aún no hay reglas">
            Crea la primera con el formulario de abajo. Las reglas nuevas quedan inactivas hasta que las actives.
          </EmptyState>
        </Card>
      ) : (
        <ul className="stagger space-y-3">
          {rules.map((r) => {
            const url = r.postId ? posts.find((p) => p.id === r.postId)?.url : undefined;
            return (
              <li key={r.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                <div className="flex flex-wrap items-center gap-3">
                  <form action={toggleCommentRuleAction.bind(null, r.id, !r.active)}>
                    <SwitchSubmit on={r.active} label={r.active ? `Desactivar ${r.name}` : `Activar ${r.name}`} />
                  </form>
                  <div className={`min-w-0 flex-1 ${r.active ? "" : "opacity-60"}`}>
                    <p className="truncate text-sm font-semibold text-slate-900">{r.name}</p>
                    <p className="text-xs text-slate-500">
                      {r._count.comments === 1 ? "1 comentario atendido" : `${r._count.comments} comentarios atendidos`}
                    </p>
                  </div>
                  <form action={deleteCommentRuleAction.bind(null, r.id)}>
                    <SubmitButton variant="ghost-danger" size="icon" aria-label={`Borrar regla ${r.name}`} title="Borrar regla" confirm={`¿Borrar la regla "${r.name}"?`} pendingText="">
                      <Trash2 aria-hidden />
                    </SubmitButton>
                  </form>
                </div>
                <div className={`mt-3 space-y-2 ${r.active ? "" : "opacity-60"}`}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge>{r.channel ? CHANNEL_LABEL[r.channel] : "Instagram y Facebook"}</Badge>
                    {r.postId ? (
                      <Badge tone="brand">
                        Publicación {r.postLabel ?? r.postId}
                        {url && (
                          <a href={url} target="_blank" rel="noreferrer" aria-label="Ver publicación" className="hover:text-brand-900">
                            <ExternalLink aria-hidden />
                          </a>
                        )}
                      </Badge>
                    ) : (
                      <Badge>Todas las publicaciones</Badge>
                    )}
                    {r.keywords.length ? (
                      r.keywords.map((k) => (
                        <span key={k} className="rounded-md bg-amber-50 px-1.5 py-0.5 font-mono text-xs text-amber-900 ring-1 ring-inset ring-amber-200">
                          {k}
                        </span>
                      ))
                    ) : (
                      <Badge>Cualquier comentario</Badge>
                    )}
                  </div>
                  {(r.publicReply || r.privateReply) && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {r.publicReply && (
                        <p className="flex gap-2 rounded-lg bg-slate-50 p-2.5 text-sm text-slate-700">
                          <Globe aria-label="Respuesta pública" className="mt-0.5 size-4 shrink-0 text-slate-400" />
                          {r.publicReply}
                        </p>
                      )}
                      {r.privateReply && (
                        <p className="flex gap-2 rounded-lg bg-brand-50/60 p-2.5 text-sm text-slate-700">
                          <Lock aria-label="Mensaje privado" className="mt-0.5 size-4 shrink-0 text-brand-500" />
                          {r.privateReply}
                        </p>
                      )}
                    </div>
                  )}
                  {(r.hide || r.remove) && (
                    <p className="flex items-center gap-1.5 text-xs font-medium text-rose-700">
                      {r.hide ? <EyeOff aria-hidden className="size-3.5" /> : <Trash2 aria-hidden className="size-3.5" />}
                      {r.hide ? "Oculta el comentario" : "Borra el comentario"}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Panel icon={<Plus />} title="Nueva regla" description="Meta permite un solo mensaje privado por comentario, dentro de 7 días.">
        <CommentRuleForm posts={posts} postsError={error} />
      </Panel>
    </div>
  );
}
