import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { db, rootDb } from "../db";
import { DEFAULT_ASSISTANT, getAssistantSettings, getSetting, setSetting } from "../settings";
import { currentCompanyId } from "../tenant";

/** Datos públicos de la política de privacidad (Meta los pide para revisar la app). */
export type LegalSettings = {
  /** Razón social o nombre de la empresa responsable de los datos. */
  legalName: string;
  /** Correo donde las personas ejercen sus derechos sobre sus datos. */
  contactEmail: string;
};

/**
 * Sin empresa responsable configurada se usa el nombre de la empresa de la asistente y, si
 * sigue siendo el genérico ("nuestra empresa"), el nombre de la empresa en Beliapp: la política
 * pública siempre nombra a alguien.
 */
export async function getLegalSettings(): Promise<LegalSettings> {
  const saved = await getSetting<Partial<LegalSettings>>("legal", {});
  const { companyName } = await getAssistantSettings();
  const named = companyName !== DEFAULT_ASSISTANT.companyName ? companyName : "";
  const legalName =
    saved.legalName ||
    named ||
    (await rootDb.company.findUnique({ where: { id: await currentCompanyId() }, select: { name: true } }))?.name ||
    companyName;
  return { legalName, contactEmail: saved.contactEmail ?? "" };
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
 * Borra todo lo que Beliapp guarda de una persona de Instagram o Facebook: sus contactos (con sus
 * leads, conversaciones y tareas) y sus comentarios. Meta manda el id de la persona en la app,
 * distinto del que llega en los mensajes; `pageIds` son los de la página que se le pudieron
 * asociar. Si no se borra nada, la solicitud queda pendiente de revisión manual en vez de
 * confirmarse. Devuelve la solicitud, con el código para consultarla.
 */
export async function deleteMetaUserData(appUserId: string, pageIds: string[] = []) {
  const code = randomBytes(6).toString("hex").toUpperCase();
  const ids = [appUserId, ...pageIds];
  return db.$transaction(async (tx) => {
    const contacts = await tx.contact.deleteMany({
      where: { channel: { in: ["INSTAGRAM", "FACEBOOK"] }, externalId: { in: ids } },
    });
    const comments = await tx.socialComment.deleteMany({ where: { authorId: { in: ids } } });
    return tx.dataDeletionRequest.create({
      data: {
        code,
        externalUserId: appUserId,
        contacts: contacts.count,
        comments: comments.count,
        pending: contacts.count + comments.count === 0,
      },
    });
  });
}

export function pendingDeletionRequests() {
  return db.dataDeletionRequest.findMany({ where: { pending: true }, orderBy: { createdAt: "asc" } });
}

/** El equipo revisó a mano una solicitud pendiente (borró lo que encontró o no había nada). */
export async function resolveDeletionRequest(id: string) {
  await db.dataDeletionRequest.update({ where: { id }, data: { pending: false } });
}

export function findDeletionRequest(code: string) {
  return db.dataDeletionRequest.findUnique({ where: { code: code.trim().toUpperCase() } });
}
