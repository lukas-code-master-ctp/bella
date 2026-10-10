import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { CommentsApi } from "@/lib/channels/comments";
import type { MessengerWebhook } from "@/lib/channels/messenger";
import { receiveComments } from "@/lib/domain/comments";
import {
  applyCommentRules,
  createCommentRule,
  parseKeywords,
  pickRule,
  setCommentRuleActive,
  type CommentRuleInput,
} from "@/lib/domain/comment-rules";

const igComment = (id: string, text: string, post = "post-1", parentId?: string): MessengerWebhook => ({
  object: "instagram",
  entry: [
    {
      id: "ig-1",
      changes: [{ field: "comments", value: { id, text, from: { id: `u-${id}`, username: "camila.r" }, media: { id: post }, parent_id: parentId } }],
    },
  ],
});

function fakeApi(failOn?: string) {
  const calls: string[] = [];
  const api: CommentsApi = {
    reply: async (platform, id, text) => {
      if (failOn === "reply") throw new Error("Meta caído");
      calls.push(`reply ${platform} ${id}: ${text}`);
      return "r1";
    },
    privateReply: async (id, text) => {
      if (failOn === "private") throw new Error("Meta caído");
      calls.push(`private ${id}: ${text}`);
      return "m1";
    },
    hide: async (platform, id, hidden) => {
      calls.push(`hide ${platform} ${id} ${hidden}`);
    },
    remove: async (id) => {
      calls.push(`remove ${id}`);
    },
  };
  return { api, calls };
}

const base: CommentRuleInput = {
  name: "Regla",
  channel: null,
  postId: null,
  postLabel: null,
  keywords: [],
  publicReply: null,
  privateReply: null,
  hide: false,
  remove: false,
};

async function activeRule(input: Partial<CommentRuleInput>) {
  const r = await createCommentRule({ ...base, ...input });
  await setCommentRuleActive(r.id, true);
  return r;
}

beforeEach(() => {
  process.env.META_IG_ACCOUNT_ID = "ig-1";
});
afterEach(() => {
  delete process.env.META_IG_ACCOUNT_ID;
});

describe("reglas de comentarios", () => {
  it("se crean inactivas y no hacen nada hasta activarlas", async () => {
    const r = await createCommentRule({ ...base, publicReply: "Hola" });
    expect(r.active).toBe(false);
    const ids = await receiveComments(igComment("c1", "precio?"));
    const { api, calls } = fakeApi();
    expect(await applyCommentRules(ids, api)).toBe(0);
    expect(calls).toEqual([]);
  });

  it("responde en público y por privado a la publicación y palabras de la regla, sin tildes ni mayúsculas", async () => {
    const rule = await activeRule({
      postId: "post-1",
      keywords: parseKeywords("información, precio, Información"),
      publicReply: "¡Hola {nombre}! Te escribimos por DM",
      privateReply: "Hola, ¿qué te gustaría saber?",
    });
    expect(rule.keywords).toEqual(["información", "precio"]);
    const ids = [
      ...(await receiveComments(igComment("c1", "Quiero INFORMACION porfa"))),
      ...(await receiveComments(igComment("c2", "Qué lindo"))),
      ...(await receiveComments(igComment("c3", "precio?", "post-2"))),
    ];
    const { api, calls } = fakeApi();
    expect(await applyCommentRules(ids, api)).toBe(1);
    expect(calls).toEqual(["reply INSTAGRAM c1: ¡Hola @camila.r! Te escribimos por DM", "private c1: Hola, ¿qué te gustaría saber?"]);

    const c1 = await db.socialComment.findUniqueOrThrow({ where: { externalId: "c1" } });
    expect([c1.ruleId, c1.doneAt !== null, c1.privateAt !== null, c1.repliedById]).toEqual([rule.id, true, true, null]);
    const pending = await db.socialComment.findMany({ where: { doneAt: null }, orderBy: { externalId: "asc" } });
    expect(pending.map((c) => c.externalId)).toEqual(["c2", "c3"]);
  });

  it("gana la regla más específica e ignora respuestas dentro de un hilo", async () => {
    await activeRule({ name: "General", hide: true });
    const specific = await activeRule({ name: "Post", postId: "post-1", keywords: ["precio"], privateReply: "Te cuento" });
    const ids = [
      ...(await receiveComments(igComment("c1", "precio"))),
      ...(await receiveComments(igComment("c2", "spam spam", "post-9"))),
      ...(await receiveComments(igComment("c3", "precio", "post-1", "c1"))),
    ];
    const { api, calls } = fakeApi();
    expect(await applyCommentRules(ids, api)).toBe(2);
    expect(calls).toEqual(["private c1: Te cuento", "hide INSTAGRAM c2 true"]);
    expect((await db.socialComment.findUniqueOrThrow({ where: { externalId: "c1" } })).ruleId).toBe(specific.id);
    expect((await db.socialComment.findUniqueOrThrow({ where: { externalId: "c3" } })).doneAt).toBeNull();
  });

  it("borra el comentario y no permite responder en público si borra", async () => {
    await expect(createCommentRule({ ...base, remove: true, publicReply: "x" })).rejects.toThrow(/no puede responderlo/);
    await expect(createCommentRule(base)).rejects.toThrow(/al menos una acción/);
    await activeRule({ remove: true, keywords: ["estafa"] });
    const ids = await receiveComments(igComment("c1", "Esto es una estafa"));
    const { api, calls } = fakeApi();
    await applyCommentRules(ids, api);
    expect(calls).toEqual(["remove c1"]);
    const c = await db.socialComment.findFirstOrThrow();
    expect([c.removedAt !== null, c.doneAt !== null]).toEqual([true, true]);
  });

  it("si Meta falla, el comentario queda pendiente con lo que alcanzó a hacerse", async () => {
    await activeRule({ publicReply: "Hola", privateReply: "Te escribo" });
    const ids = await receiveComments(igComment("c1", "info"));
    const { api, calls } = fakeApi("private");
    expect(await applyCommentRules(ids, api)).toBe(0);
    expect(calls).toEqual(["reply INSTAGRAM c1: Hola"]);
    const c = await db.socialComment.findFirstOrThrow();
    expect([c.reply, c.doneAt, c.ruleId]).toEqual(["Hola", null, null]);
  });

  it("filtra por red social", () => {
    const rules = [{ channel: "FACEBOOK" as const, postId: null, keywords: [], createdAt: new Date() }];
    expect(pickRule(rules, { channel: "INSTAGRAM", postId: "p", text: "hola" })).toBeNull();
    expect(pickRule(rules, { channel: "FACEBOOK", postId: "p", text: "hola" })).toBe(rules[0]);
  });
});
