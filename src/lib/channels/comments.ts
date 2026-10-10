import { ChannelSendError } from "./whatsapp";
import { pageGraph, type MetaPlatform } from "./messenger";

/** Acciones sobre comentarios de Instagram y Facebook. Se reemplaza en pruebas. */
export type CommentsApi = {
  /** Respuesta pública en el hilo del comentario; devuelve el id de la respuesta. */
  reply(platform: MetaPlatform, commentId: string, text: string): Promise<string>;
  /** Mensaje privado al autor del comentario (Meta permite uno por comentario). */
  privateReply(commentId: string, text: string): Promise<string>;
  hide(platform: MetaPlatform, commentId: string, hidden: boolean): Promise<void>;
  /** Borra el comentario en Meta. */
  remove(commentId: string): Promise<void>;
};

/** Publicación reciente de Instagram o de la página, para elegirla en una regla. */
export type SocialPost = { id: string; channel: MetaPlatform; label: string; url: string | null; at: string | null };

const post = <T>(path: string, body: object) => pageGraph<T>(path, { method: "POST", body: JSON.stringify(body) });

export const commentsApi: CommentsApi = {
  async reply(platform, commentId, text) {
    // Instagram responde en /replies; Facebook, como un comentario del comentario.
    const res = await post<{ id?: string }>(
      platform === "INSTAGRAM" ? `${commentId}/replies` : `${commentId}/comments`,
      { message: text },
    );
    if (!res.id) throw new ChannelSendError("Meta no devolvió el id de la respuesta.");
    return res.id;
  },
  async privateReply(commentId, text) {
    const pageId = process.env.META_PAGE_ID;
    if (!pageId) throw new ChannelSendError("Falta META_PAGE_ID en las variables de entorno.");
    const res = await post<{ message_id?: string }>(`${pageId}/messages`, {
      recipient: { comment_id: commentId },
      message: { text },
    });
    if (!res.message_id) throw new ChannelSendError("Meta no devolvió el id del mensaje.");
    return res.message_id;
  },
  async hide(platform, commentId, hidden) {
    await post(commentId, platform === "INSTAGRAM" ? { hide: hidden } : { is_hidden: hidden });
  },
  async remove(commentId) {
    await pageGraph(commentId, { method: "DELETE" });
  },
};

const caption = (text: string | undefined, fallback: string) => {
  const line = (text ?? "").split("\n")[0].trim();
  return line ? (line.length > 80 ? `${line.slice(0, 79)}…` : line) : fallback;
};

/** Últimas publicaciones de la cuenta de Instagram y de la página de Facebook conectadas. */
export async function recentPosts(): Promise<SocialPost[]> {
  const igId = process.env.META_IG_ACCOUNT_ID;
  const pageId = process.env.META_PAGE_ID;
  const [ig, fb] = await Promise.all([
    igId
      ? pageGraph<{ data?: { id: string; caption?: string; permalink?: string; timestamp?: string }[] }>(
          `${igId}/media?fields=id,caption,permalink,timestamp&limit=30`,
        )
      : null,
    pageId
      ? pageGraph<{ data?: { id: string; message?: string; permalink_url?: string; created_time?: string }[] }>(
          `${pageId}/posts?fields=id,message,permalink_url,created_time&limit=30`,
        )
      : null,
  ]);
  return [
    ...(ig?.data ?? []).map((p) => ({
      id: p.id,
      channel: "INSTAGRAM" as const,
      label: caption(p.caption, "Publicación sin texto"),
      url: p.permalink ?? null,
      at: p.timestamp ?? null,
    })),
    ...(fb?.data ?? []).map((p) => ({
      id: p.id,
      channel: "FACEBOOK" as const,
      label: caption(p.message, "Publicación sin texto"),
      url: p.permalink_url ?? null,
      at: p.created_time ?? null,
    })),
  ];
}
