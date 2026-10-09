import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "../db";
import { getAssistantSettings, getSetting, setSetting } from "../settings";

/** Datos públicos de la política de privacidad (Meta los pide para revisar la app). */
export type LegalSettings = {
  /** Razón social o nombre de la empresa responsable de los datos. */
  legalName: string;
  /** Correo donde las personas ejercen sus derechos sobre sus datos. */
  contactEmail: string;
};

export async function getLegalSettings(): Promise<LegalSettings> {
  const saved = await getSetting<Partial<LegalSettings>>("legal", {});
  const { companyName } = await getAssistantSettings();
  return { legalName: saved.legalName || companyName, contactEmail: saved.contactEmail ?? "" };
}

export async function saveLegalSettings(s: LegalSettings) {
  await setSetting("legal", s);
}

/**
 * Lee el `signed_request` que Meta manda al pedir un borrado: "firma.payload" en base64url,
 * firmado con HMAC-SHA256 y la clave secreta de la app. Devuelve null si la firma no calza.
 */
export function parseSignedRequest(signed: string, secret: string | undefined): { user_id?: string } | null {
  const [sig, payload] = signed.split(".", 2);
  if (!secret || !sig || !payload) return null;
  const expected = createHmac("sha256", secret).update(payload).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { user_id?: string };
  } catch {
    return null;
  }
}

/**
 * Borra todo lo que Bella guarda de una persona de Instagram o Facebook: sus contactos (con sus
 * leads, conversaciones y tareas) y sus comentarios. Devuelve el código para consultar el pedido.
 */
export async function deleteMetaUserData(externalUserId: string) {
  const code = randomBytes(6).toString("hex").toUpperCase();
  return db.$transaction(async (tx) => {
    const contacts = await tx.contact.deleteMany({
      where: { channel: { in: ["INSTAGRAM", "FACEBOOK"] }, externalId: externalUserId },
    });
    const comments = await tx.socialComment.deleteMany({ where: { authorId: externalUserId } });
    return tx.dataDeletionRequest.create({
      data: { code, externalUserId, contacts: contacts.count, comments: comments.count },
    });
  });
}

export function findDeletionRequest(code: string) {
  return db.dataDeletionRequest.findUnique({ where: { code: code.trim().toUpperCase() } });
}
