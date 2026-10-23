import type { EmailDomain } from "@prisma/client";
import { db, rootDb } from "../db";
import { currentCompanyId } from "../tenant";
import { DomainError } from "./leads";

/**
 * Dominio de envío de cada empresa para sus envíos masivos por correo. Los avisos del equipo
 * siguen saliendo del dominio de Beliapp (src/lib/email.ts); los newsletters salen del dominio
 * de la empresa, así la reputación de una no afecta a las demás ni a los avisos. Todos los
 * dominios viven en la cuenta Resend de la plataforma (RESEND_API_KEY): la empresa solo agrega
 * en su DNS los registros que entrega Resend.
 */

/** Registro DNS que pide Resend (SPF, DKIM, MX de rebotes…). */
export type DnsRecord = {
  record: string;
  name: string;
  type: string;
  value: string;
  ttl?: string;
  priority?: number;
  status?: string;
};

export type ResendDomain = { id: string; name: string; status: string; records: DnsRecord[] };

/** Lo que Beliapp usa de la API de dominios de Resend. Se reemplaza en pruebas. */
export type EmailDomainsApi = {
  create(name: string): Promise<ResendDomain>;
  get(id: string): Promise<ResendDomain>;
  verify(id: string): Promise<void>;
  /** Activa el seguimiento de aperturas y clics (para las métricas de cada envío). */
  track(id: string): Promise<void>;
  remove(id: string): Promise<void>;
};

async function resend<T>(method: string, path: string, body?: object): Promise<T> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new DomainError("Falta RESEND_API_KEY en el servidor de Beliapp.");
  const res = await fetch(`https://api.resend.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new DomainError(`Resend respondió: ${json.message ?? `HTTP ${res.status}`}`);
  return json;
}

export const resendDomainsApi: EmailDomainsApi = {
  create: (name) => resend<ResendDomain>("POST", "/domains", { name }),
  get: (id) => resend<ResendDomain>("GET", `/domains/${id}`),
  verify: async (id) => {
    await resend("POST", `/domains/${id}/verify`);
  },
  track: async (id) => {
    await resend("PATCH", `/domains/${id}`, { open_tracking: true, click_tracking: true });
  },
  remove: async (id) => {
    await resend("DELETE", `/domains/${id}`);
  },
};

const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const LOCAL_RE = /^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Dominio escrito por el admin, sin "https://", "www." ni rutas. */
export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^@/, "")
    .replace(/\.$/, "");
}

export type SenderInput = { fromName: string; fromLocal: string; replyTo: string };

function cleanSender(s: SenderInput): SenderInput {
  const fromName = s.fromName.replace(/[<>"\r\n]/g, "").trim().slice(0, 80);
  const fromLocal = s.fromLocal.trim().toLowerCase() || "noticias";
  const replyTo = s.replyTo.trim().toLowerCase();
  if (!fromName) throw new DomainError("Escribe el nombre que verán las personas como remitente.");
  if (!LOCAL_RE.test(fromLocal)) throw new DomainError("La dirección del remitente solo puede tener letras, números, puntos y guiones (ej. noticias).");
  if (replyTo && !EMAIL_RE.test(replyTo)) throw new DomainError("La dirección para respuestas no es un correo válido.");
  return { fromName, fromLocal, replyTo };
}

export function getEmailDomain() {
  return db.emailDomain.findFirst();
}

/**
 * Registra el dominio de la empresa en Resend y guarda los registros DNS que hay que agregar.
 * Conviene un subdominio propio para los envíos (noticias.suempresa.cl), así los rebotes de un
 * newsletter no afectan a los correos del día a día de la empresa.
 */
export async function connectEmailDomain(input: { domain: string } & SenderInput, api: EmailDomainsApi = resendDomainsApi) {
  const domain = normalizeDomain(input.domain);
  if (!DOMAIN_RE.test(domain)) throw new DomainError("Escribe un dominio válido, por ejemplo noticias.tuempresa.cl.");
  if (domain === "beliapp.cl" || domain.endsWith(".beliapp.cl")) throw new DomainError("Usa un dominio de tu empresa, no uno de Beliapp.");
  const sender = cleanSender(input);
  if (await getEmailDomain()) throw new DomainError("Ya tienes un dominio de envío. Quítalo antes de conectar otro.");
  if (await rootDb.emailDomain.findUnique({ where: { domain }, select: { id: true } })) {
    throw new DomainError("Ese dominio ya está conectado en otra empresa de Beliapp.");
  }
  const created = await api.create(domain);
  await api.track(created.id);
  return db.emailDomain.create({
    data: { domain, resendId: created.id, status: created.status, records: created.records ?? [], ...sender },
  });
}

/** Pide a Resend revisar el DNS y guarda el estado. Devuelve el dominio actualizado. */
export async function checkEmailDomain(api: EmailDomainsApi = resendDomainsApi): Promise<EmailDomain> {
  const current = await getEmailDomain();
  if (!current) throw new DomainError("Aún no conectas un dominio de envío.");
  if (current.status !== "verified") await api.verify(current.resendId);
  const fresh = await api.get(current.resendId);
  return db.emailDomain.update({
    where: { id: current.id },
    data: {
      status: fresh.status,
      records: fresh.records ?? current.records ?? [],
      checkedAt: new Date(),
      verifiedAt: fresh.status === "verified" ? (current.verifiedAt ?? new Date()) : null,
    },
  });
}

export async function updateEmailSender(input: SenderInput) {
  const current = await getEmailDomain();
  if (!current) throw new DomainError("Aún no conectas un dominio de envío.");
  return db.emailDomain.update({ where: { id: current.id }, data: cleanSender(input) });
}

/** Quita el dominio de Beliapp y de Resend. Si en Resend ya no existe, igual se quita aquí. */
export async function removeEmailDomain(api: EmailDomainsApi = resendDomainsApi) {
  const current = await getEmailDomain();
  if (!current) return;
  try {
    await api.remove(current.resendId);
  } catch (e) {
    if (!(e instanceof DomainError && /not.?found|404/i.test(e.message))) throw e;
  }
  await db.emailDomain.delete({ where: { id: current.id } });
}

/** Remitente de los envíos masivos de la empresa, o null si su dominio aún no está verificado. */
export async function companyEmailSender(): Promise<{ from: string; replyTo?: string } | null> {
  const d = await getEmailDomain();
  if (!d || d.status !== "verified") return null;
  return { from: `${d.fromName} <${d.fromLocal}@${d.domain}>`, replyTo: d.replyTo || undefined };
}

/** Empresa dueña de un remitente, a partir del dominio de la dirección (webhooks de Resend). */
export async function companyForSender(address: string): Promise<string | null> {
  const domain = address.match(/@([^>\s]+)>?\s*$/)?.[1]?.toLowerCase();
  if (!domain) return null;
  const row = await rootDb.emailDomain.findUnique({ where: { domain }, select: { companyId: true } });
  return row?.companyId ?? null;
}

/** Nombre sugerido para el remitente: el de la empresa en Beliapp. */
export async function defaultFromName(): Promise<string> {
  const company = await rootDb.company.findUnique({ where: { id: await currentCompanyId() }, select: { name: true } });
  return company?.name ?? "";
}
