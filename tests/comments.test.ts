import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { CommentsApi } from "@/lib/channels/comments";
import type { MessengerWebhook } from "@/lib/channels/messenger";
import { canPrivateReply, countPendingComments, receiveComments, replyToComment, setCommentHidden } from "@/lib/domain/comments";
import { executive } from "./factories";

const PAGE_ID = "page-1";
const IG_ID = "ig-1";

const igComment = (id: string, text: string, from = { id: "u1", username: "camila.r" }): MessengerWebhook => ({
  object: "instagram",
  entry: [{ id: IG_ID, changes: [{ field: "comments", value: { id, text, from, media: { id: "post-1" } } }] }],
});

const fbComment = (commentId: string, message: string, extra: object = {}): MessengerWebhook => ({
  object: "page",
  entry: [
    {
      id: PAGE_ID,
      changes: [
        {
          field: "feed",
          value: { item: "comment", verb: "add", comment_id: commentId, post_id: "p1", parent_id: "p1", message, from: { id: "u2", name: "Pedro Soto" }, ...extra },
        },
      ],
    },
  ],
});

function fakeApi() {
  const calls: string[] = [];
  const api: CommentsApi = {
    reply: async (platform, id, text) => {
      calls.push(`reply ${platform} ${id}: ${text}`);
      return "r1";
    },
    privateReply: async (id, text) => {
      calls.push(`private ${id}: ${text}`);
      return "m1";
    },
    hide: async (platform, id, hidden) => {
      calls.push(`hide ${platform} ${id} ${hidden}`);
    },
  };
  return { api, calls };
}

beforeEach(() => {
  process.env.META_PAGE_ID = PAGE_ID;
  process.env.META_IG_ACCOUNT_ID = IG_ID;
});
afterEach(() => {
  delete process.env.META_PAGE_ID;
  delete process.env.META_IG_ACCOUNT_ID;
});

describe("comentarios de Instagram y Facebook", () => {
  it("guarda los comentarios nuevos una sola vez e ignora los de la propia cuenta", async () => {
    await receiveComments(igComment("c1", "¿Precio?"));
    await receiveComments(igComment("c1", "¿Precio?")); // reintento de Meta
    await receiveComments(igComment("c2", "Gracias por comentar", { id: IG_ID, username: "nosotros" }));
    await receiveComments(fbComment("p1_c3", "¿Dónde quedan?"));
    await receiveComments(fbComment("p1_c4", "editado", { verb: "edited" }));

    const all = await db.socialComment.findMany({ orderBy: { createdAt: "asc" } });
    expect(all.map((c) => [c.channel, c.authorName, c.text, c.postId, c.parentId])).toEqual([
      ["INSTAGRAM", "@camila.r", "¿Precio?", "post-1", null],
      ["FACEBOOK", "Pedro Soto", "¿Dónde quedan?", "p1", null],
    ]);
    expect(await countPendingComments()).toBe(2);
  });

  it("responde en público por la plataforma del comentario y lo deja resuelto", async () => {
    const user = await executive("Eje");
    await receiveComments(igComment("c1", "¿Precio?"));
    const c = await db.socialComment.findFirstOrThrow();
    const { api, calls } = fakeApi();
    await replyToComment(c.id, "public", "Te escribimos por DM 😊", user.id, api);

    expect(calls).toEqual(["reply INSTAGRAM c1: Te escribimos por DM 😊"]);
    const saved = await db.socialComment.findFirstOrThrow();
    expect([saved.reply, saved.repliedById, saved.doneAt !== null]).toEqual(["Te escribimos por DM 😊", user.id, true]);
    expect(await countPendingComments()).toBe(0);
  });

  it("el mensaje privado se manda una sola vez y solo dentro de 7 días", async () => {
    const user = await executive("Eje");
    await receiveComments(fbComment("p1_c3", "Info"));
    const c = await db.socialComment.findFirstOrThrow();
    const { api, calls } = fakeApi();
    await replyToComment(c.id, "private", "Hola Pedro, te cuento por acá", user.id, api);
    await expect(replyToComment(c.id, "private", "otra vez", user.id, api)).rejects.toThrow(/Ya se le envió/);
    expect(calls).toEqual(["private p1_c3: Hola Pedro, te cuento por acá"]);

    const old = { privateAt: null, createdAt: new Date(Date.now() - 8 * 86_400_000) };
    expect(canPrivateReply(old)).toBe(false);
  });

  it("oculta y vuelve a mostrar un comentario", async () => {
    await receiveComments(fbComment("p1_c3", "spam"));
    const c = await db.socialComment.findFirstOrThrow();
    const { api, calls } = fakeApi();
    await setCommentHidden(c.id, true, api);
    expect((await db.socialComment.findFirstOrThrow()).hidden).toBe(true);
    await setCommentHidden(c.id, false, api);
    expect(calls).toEqual(["hide FACEBOOK p1_c3 true", "hide FACEBOOK p1_c3 false"]);
  });
});
