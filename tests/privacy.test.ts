import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createLead } from "@/lib/domain/leads";
import { deleteMetaUserData, findDeletionRequest, getLegalSettings, parseSignedRequest, saveLegalSettings } from "@/lib/domain/privacy";
import { setSetting } from "@/lib/settings";
import { seedFunnel } from "./factories";

function signedRequest(payload: object, secret: string) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest().toString("base64url");
  return `${sig}.${body}`;
}

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

  it("la política usa el nombre de la empresa de la asistente hasta que se configure otro", async () => {
    await setSetting("assistant", { companyName: "Compra tu Parcela" });
    expect(await getLegalSettings()).toEqual({ legalName: "Compra tu Parcela", contactEmail: "" });
    await saveLegalSettings({ legalName: "CTP SpA", contactEmail: "privacidad@ctp.cl" });
    expect((await getLegalSettings()).legalName).toBe("CTP SpA");
  });
});
