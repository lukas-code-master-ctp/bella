import { ChannelSendError } from "./whatsapp";
import { pageGraph, type MetaPlatform } from "./messenger";

/** Acciones sobre comentarios de Instagram y Facebook. Se reemplaza en pruebas. */
export type CommentsApi = {
  /** Respuesta pública en el hilo del comentario; devuelve el id de la respuesta. */
  reply(platform: MetaPlatform, commentId: string, text: string): Promise<string>;
  /** Mensaje privado al autor del comentario (Meta permite uno por comentario). */
  privateReply(commentId: string, text: string): Promise<string>;
  hide(platform: MetaPlatform, commentId: string, hidden: boolean): Promise<void>;
};

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
};
