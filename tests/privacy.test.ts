import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveCredentials } from "@/lib/credentials";
import { pageScopedIds } from "@/lib/channels/messenger";
import { db } from "@/lib/db";
import { createLead } from "@/lib/domain/leads";
import {
  deleteMetaUserData,
  findDeletionRequest,
  getLegalSettings,
  parseSignedRequest,
  pendingDeletionRequests,
  resolveDeletionRequest,
  saveLegalSettings,
} from "@/lib/domain/privacy";
import { setSetting } from "@/lib/settings";
import { seedFunnel } from "./factories";

function signedRequest(payload: object, secret: string) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest().toString("base64url");
  return `${sig}.${body}`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("privacidad y eliminación de datos", () => {
  it("lee el signed_request de Meta solo si está firmado con la clave de la app", () => {
    const signed = signedRequest({ algorithm: "HMAC-SHA256", user_id: "u-1" }, "secreto");
    expect(parseSignedRequest(signed, "secreto")?.user_id).toBe("u-1");
    expect(parseSignedRequest(signed, "otra")).toBeNull();
    expect(parseSignedRequest(signed, undefined)).toBeNull();
    expect(parseSignedRequest("basura", "secreto")).toBeNull();
  });

  it("borra los contactos de Instagram o Facebook de la persona con sus conversaciones y comentarios", async () => {
    await seedFunnel();
    const ig = await createLead({ name: "@camila", channel: "INSTAGRAM", externalId: "u-1" });
    await db.message.create({ data: { leadId: ig.id, author: "CONTACT", body: "Hola" } });
    const other = await createLead({ name: "Pedro", channel: "FACEBOOK", externalId: "u-2" });
    await db.socialComment.create({ data: { channel: "INSTAGRAM", externalId: "c1", authorId: "u-1", authorName: "@camila", text: "¿Precio?" } });

    const req = await deleteMetaUserData("u-1");
    expect([req.contacts, req.comments]).toEqual([1, 1]);
    expect(await db.lead.findMany({ select: { id: true } })).toEqual([{ id: other.id }]);
    expect(await db.message.count()).toBe(0);
    expect(await db.socialComment.count()).toBe(0);
    expect((await findDeletionRequest(req.code.toLowerCase()))?.id).toBe(req.id);
  });

  it("borra por los ids de la página asociados; si no encuentra nada, queda pendiente en vez de confirmarse", async () => {
    await seedFunnel();
    await createLead({ name: "Pedro", channel: "FACEBOOK", externalId: "psid-9" });
    const found = await deleteMetaUserData("asid-1", ["psid-9"]);
    expect([found.contacts, found.pending]).toEqual([1, false]);

    const none = await deleteMetaUserData("asid-2");
    expect([none.contacts, none.comments, none.pending]).toEqual([0, 0, true]);
    expect((await pendingDeletionRequests()).map((r) => r.id)).toEqual([none.id]);
    await resolveDeletionRequest(none.id);
    expect(await pendingDeletionRequests()).toEqual([]);
  });

  it("traduce el id de la app a los de la página configurada; si Meta falla, ninguno", async () => {
    await saveCredentials({ META_PAGE_ACCESS_TOKEN: "tok", META_PAGE_ID: "page-1" });
    const data = [
      { id: "psid-1", page: { id: "page-1" } },
      { id: "psid-2", page: { id: "otra" } },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data })));
    expect(await pageScopedIds("asid-1")).toEqual(["psid-1"]);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { message: "sin permiso", code: 200 } }, { status: 400 })));
    expect(await pageScopedIds("asid-1")).toEqual([]);
  });

  it("la política usa el nombre de la empresa de la asistente hasta que se configure otro", async () => {
    await setSetting("assistant", { companyName: "Compra tu Parcela" });
    expect(await getLegalSettings()).toEqual({ legalName: "Compra tu Parcela", contactEmail: "" });
    await saveLegalSettings({ legalName: "CTP SpA", contactEmail: "privacidad@ctp.cl" });
    expect((await getLegalSettings()).legalName).toBe("CTP SpA");
  });

  it("sin nombre de empresa en la asistente, la política usa el nombre de la empresa en Beliapp", async () => {
    expect((await getLegalSettings()).legalName).toBe("Empresa de prueba");
  });
});
