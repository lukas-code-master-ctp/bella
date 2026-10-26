import { Prisma, type EmailBroadcast, type EmailRecipient, type LeadStatus } from "@prisma/client";
import { db } from "../db";
import { parseLocalDateTime } from "../dates";
import { currentCompanyId } from "../tenant";
import { EmailError, RESEND_BATCH_MAX, type Email, type EmailBatchSender, type EmailSender } from "../email";
import { contentError, personalize, renderEmailHtml, renderEmailText, usedVars, varsFor, type EmailBlock, type EmailContent } from "../email-content";
import { companyEmailSender, companyResendBatchSender, companyResendKey, companyResendSender, getEmailDomain } from "./email-domains";
import { normalizeEmail, suppressedAmong, unsubscribeLinks } from "./email-suppression";
import { DomainError } from "./leads";

/**
 * Envíos masivos por correo (newsletters): un correo armado con bloques a una lista de
 * personas, desde el dominio verificado de la empresa. Sale por tandas de hasta 100 desde el cron
 * (y apenas se crea), sin pasar el máximo diario. Se deja fuera a quien se dio de baja, rebotó o
 * marcó spam, y el envío se pausa solo si los rebotes o las quejas pasan lo que aceptan Gmail y
 * Yahoo, para cuidar la reputación del dominio. Se puede programar, probar dos asuntos (A/B) y
 * reenviar a quienes no abrieron.
 */

export const MAX_EMAIL_RECIPIENTS = 50_000;
const STUCK_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Con al menos estos enviados se revisa la tasa de rebotes y quejas. */
const REPUTATION_MIN_SENT = 100;
const MAX_BOUNCE_RATE = 0.05;
const MAX_COMPLAINT_RATE = 0.003;
const MAX_SCHEDULE_MS = 60 * DAY_MS;
/** En la prueba A/B, entregados que necesita cada asunto antes de nombrar un ganador. */
export const AB_MIN_DELIVERED = 50;

const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[a-z]{2,}$/i;

export type EmailRow = { email: string; name?: string; values?: Record<string, string> };

export type EmailAudience =
  | { kind: "rows"; rows: EmailRow[] }
  | { kind: "funnel"; funnelId: string; stageId?: string | null; status?: LeadStatus | "ALL"; tagId?: string | null }
  /** Quienes recibieron otro envío y no lo abrieron ni hicieron clic. */
  | { kind: "resend"; emailBroadcastId: string };

/** Quien recibió el correo y no lo abrió, no hizo clic, ni rebotó o se quejó. */
const notOpened = (emailBroadcastId: string): Prisma.EmailRecipientWhereInput => ({
  emailBroadcastId,
  status: "SENT",
  openedAt: null,
  clickedAt: null,
  bouncedAt: null,
  complainedAt: null,
});

export type EmailExclusions = {
  invalid: number;
  duplicate: number;
  /** Se dio de baja, rebotó o marcó spam. */
  suppressed: number;
  blocked: number;
};

export type EmailAudit = {
  total: number;
  excluded: EmailExclusions;
  recipients: { email: string; name: string; values: Record<string, string> }[];
};

async function audienceRows(audience: EmailAudience): Promise<EmailRow[]> {
  if (audience.kind === "rows") return audience.rows;
  if (audience.kind === "resend") {
    const original = await db.emailBroadcast.findUnique({ where: { id: audience.emailBroadcastId }, select: { id: true } });
    if (!original) throw new DomainError("Ese envío no existe.");
    const rows = await db.emailRecipient.findMany({ where: notOpened(original.id), select: { email: true, name: true, values: true }, orderBy: { id: "asc" } });
    return rows.map((r) => ({ email: r.email, name: r.name, values: r.values as Record<string, string> }));
  }
  if (!(await db.funnel.count({ where: { id: audience.funnelId } }))) throw new DomainError("Ese embudo no existe.");
  const leads = await db.lead.findMany({
    where: {
      stage: { funnelId: audience.funnelId, ...(audience.stageId ? { id: audience.stageId } : {}) },
      ...(audience.status && audience.status !== "ALL" ? { status: audience.status } : {}),
      contact: { email: { not: null }, ...(audience.tagId ? { tags: { some: { tagId: audience.tagId } } } : {}) },
    },
    select: { contact: { select: { email: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: MAX_EMAIL_RECIPIENTS * 2,
  });
  return leads.map((l) => ({ email: l.contact.email ?? "", name: l.contact.name }));
}

/** A quiénes les llegaría el correo y a quiénes se deja fuera (y por qué). */
export async function auditEmailAudience(audience: EmailAudience): Promise<EmailAudit> {
  const rows = await audienceRows(audience);
  const excluded: EmailExclusions = { invalid: 0, duplicate: 0, suppressed: 0, blocked: 0 };
  const seen = new Set<string>();
  const valid: EmailAudit["recipients"] = [];
  for (const r of rows) {
    const email = normalizeEmail(String(r.email ?? ""));
    if (!EMAIL_RE.test(email)) excluded.invalid++;
    else if (seen.has(email)) excluded.duplicate++;
    else {
      seen.add(email);
      valid.push({ email, name: String(r.name ?? "").trim(), values: r.values ?? {} });
    }
  }
  const suppressed = new Set<string>();
  const blocked = new Set<string>();
  for (let i = 0; i < valid.length; i += 5000) {
    const emails = valid.slice(i, i + 5000).map((r) => r.email);
    for (const e of await suppressedAmong(emails)) suppressed.add(e);
    const contacts = await db.contact.findMany({ where: { email: { in: emails, mode: "insensitive" }, blockedAt: { not: null } }, select: { email: true } });
    for (const c of contacts) blocked.add(normalizeEmail(c.email!));
  }
  const recipients = valid.filter((r) => {
    if (suppressed.has(r.email)) excluded.suppressed++;
    else if (blocked.has(r.email)) excluded.blocked++;
    else return true;
    return false;
  });
  return { total: rows.length, excluded, recipients };
}

// --- Crear ----------------------------------------------------------------------------------

export type EmailBroadcastInput = Omit<EmailContent, "blocks"> & {
  name: string;
  blocks: EmailBlock[];
  audience: EmailAudience;
  /** Quien sube una lista declara que esas personas aceptaron recibir sus correos. */
  consent: boolean;
  dailyLimit: number;
  /** Prueba A/B: segundo asunto para la mitad de la lista; vacío si no hay prueba. */
  subjectB?: string | null;
  /** "AAAA-MM-DDTHH:MM" en hora de Chile; vacío para enviar ahora. */
  scheduledAt?: string | null;
};

/** Cuándo parte el envío programado; null si parte ahora. */
function scheduleOf(input: EmailBroadcastInput, now = new Date()): Date | null {
  if (!input.scheduledAt?.trim()) return null;
  const at = parseLocalDateTime(input.scheduledAt);
  if (!at) throw new DomainError("Revisa la fecha y hora del envío.");
  if (at.getTime() < now.getTime() + 60_000) throw new DomainError("La fecha y hora del envío ya pasó: elige una más adelante.");
  if (at.getTime() > now.getTime() + MAX_SCHEDULE_MS) throw new DomainError("Se puede programar hasta 60 días hacia adelante.");
  return at;
}

const subjectBOf = (input: EmailBroadcastInput) => input.subjectB?.trim() || null;

/** Máximo diario sugerido: un dominio nuevo parte de a poco para ganar reputación. */
export async function suggestedDailyLimit(now = new Date()): Promise<number> {
  const d = await getEmailDomain();
  const days = d?.verifiedAt ? (now.getTime() - d.verifiedAt.getTime()) / DAY_MS : 0;
  return days < 7 ? 500 : days < 30 ? 2000 : 10_000;
}

async function validate(input: EmailBroadcastInput) {
  if (!input.name.trim()) throw new DomainError("Ponle un nombre al envío.");
  const invalid = contentError(input);
  if (invalid) throw new DomainError(invalid);
  const subjectB = subjectBOf(input);
  if (subjectB && subjectB.length > 200) throw new DomainError("El asunto B es muy largo (máximo 200 caracteres).");
  if (subjectB && subjectB === input.subject.trim()) throw new DomainError("Para la prueba A/B, el asunto B tiene que ser distinto del A.");
  if (input.audience.kind === "rows" && !input.consent) {
    throw new DomainError("Confirma que las personas de la lista aceptaron recibir tus correos.");
  }
  if (!Number.isInteger(input.dailyLimit) || input.dailyLimit < 1 || input.dailyLimit > 1_000_000) {
    throw new DomainError("El máximo por día tiene que ser un número mayor que cero.");
  }
  const scheduledAt = scheduleOf(input);
  const sender = await companyEmailSender();
  if (!sender) throw new DomainError("Primero conecta y verifica tu dominio en Configuración → Canales → Correo.");
  if (!(await companyResendKey())) throw new DomainError("Primero pega la clave de Resend de tu empresa en Configuración → Credenciales.");
  return { sender, scheduledAt };
}

/** Variables que el correo usa y que no vienen en la lista: se avisan antes de enviar. */
function missingColumns(input: EmailBroadcastInput, recipients: EmailAudit["recipients"]): string[] {
  const subjectB = subjectBOf(input);
  const used = [...new Set([...usedVars(input), ...(subjectB ? usedVars({ ...input, subject: subjectB }) : [])])];
  if (!used.length) return [];
  const columns = new Set(recipients.flatMap((r) => Object.keys(varsFor("", r.values))));
  return used.filter((v) => !columns.has(v));
}

/** Revisión antes de enviar: sin guardar nada. */
export async function previewEmailBroadcast(input: EmailBroadcastInput) {
  const { sender, scheduledAt } = await validate(input);
  const audit = await auditEmailAudience(input.audience);
  const first = audit.recipients[0];
  const vars = varsFor(first?.name ?? "", first?.values);
  const content = personalize(input, vars);
  const subjectB = subjectBOf(input);
  return {
    total: audit.total,
    excluded: audit.excluded,
    count: audit.recipients.length,
    from: sender.from,
    subject: content.subject,
    subjectB: subjectB ? personalize({ ...input, subject: subjectB }, vars).subject : null,
    scheduledAt,
    sampleName: first ? first.name || first.email : null,
    missingColumns: missingColumns(input, audit.recipients),
  };
}

export async function createEmailBroadcast(input: EmailBroadcastInput, userId: string): Promise<EmailBroadcast> {
  const { scheduledAt } = await validate(input);
  const { recipients } = await auditEmailAudience(input.audience);
  if (!recipients.length) throw new DomainError("No queda nadie a quien enviarle: revisa los correos y las exclusiones.");
  if (recipients.length > MAX_EMAIL_RECIPIENTS) {
    throw new DomainError(`Un envío puede tener hasta ${MAX_EMAIL_RECIPIENTS.toLocaleString("es-CL")} personas: divide la lista.`);
  }
  const missing = missingColumns(input, recipients);
  if (missing.length) throw new DomainError(`El correo usa {{${missing[0]}}}, pero la lista no tiene esa columna.`);
  const subjectB = subjectBOf(input);
  // Con prueba A/B, la mitad de la lista (al azar) recibe cada asunto.
  const ordered = subjectB ? recipients.map((r) => ({ r, k: Math.random() })).sort((a, b) => a.k - b.k).map(({ r }) => r) : recipients;
  return db.$transaction(
    async (tx) => {
      const broadcast = await tx.emailBroadcast.create({
        data: {
          name: input.name.trim(),
          subject: input.subject.trim(),
          subjectB,
          preheader: input.preheader.trim(),
          blocks: input.blocks as Prisma.InputJsonValue,
          color: input.color,
          footer: input.footer.trim(),
          dailyLimit: input.dailyLimit,
          createdById: userId,
          ...(scheduledAt ? { status: "SCHEDULED" as const, scheduledAt } : {}),
          resentFromId: input.audience.kind === "resend" ? input.audience.emailBroadcastId : null,
        },
      });
      for (let i = 0; i < ordered.length; i += 1000) {
        await tx.emailRecipient.createMany({
          data: ordered.slice(i, i + 1000).map((r, j) => ({
            emailBroadcastId: broadcast.id,
            email: r.email,
            name: r.name,
            values: r.values,
            variant: subjectB ? (i + j) % 2 : 0,
          })),
        });
      }
      return broadcast;
    },
    { timeout: 60_000 },
  );
}

// --- Pausar, seguir, cancelar -----------------------------------------------------------

/** Un envío programado parte ya, sin esperar su hora. */
export async function sendEmailBroadcastNow(id: string) {
  await db.emailBroadcast.updateMany({ where: { id, status: "SCHEDULED" }, data: { status: "SENDING", scheduledAt: new Date() } });
}

export async function pauseEmailBroadcast(id: string) {
  await db.emailBroadcast.updateMany({ where: { id, status: "SENDING" }, data: { status: "PAUSED", note: null } });
}

export async function resumeEmailBroadcast(id: string) {
  await db.emailBroadcast.updateMany({ where: { id, status: "PAUSED" }, data: { status: "SENDING", note: null } });
}

/** Cancela lo que falta por enviar; lo ya enviado queda. */
export async function cancelEmailBroadcast(id: string) {
  await db.$transaction(async (tx) => {
    const { count } = await tx.emailBroadcast.updateMany({
      where: { id, status: { in: ["SCHEDULED", "SENDING", "PAUSED"] } },
      data: { status: "CANCELED", finishedAt: new Date() },
    });
    if (count) {
      await tx.emailRecipient.updateMany({ where: { emailBroadcastId: id, status: "PENDING" }, data: { status: "SKIPPED", error: "Se canceló el envío." } });
    }
  });
}

// --- Enviar ---------------------------------------------------------------------------------

export type EmailBroadcastRun = { sent: number; skipped: number; reason?: string };

const contentOf = (b: EmailBroadcast): EmailContent => ({
  subject: b.subject,
  preheader: b.preheader,
  blocks: b.blocks as EmailBlock[],
  color: b.color,
  footer: b.footer,
});

/** El correo de una persona, con sus variables, su enlace de baja y las cabeceras de baja. */
async function buildEmail(content: EmailContent, sender: { from: string; replyTo?: string }, r: Pick<EmailRecipient, "email" | "name" | "values">): Promise<Email> {
  const c = personalize(content, varsFor(r.name, r.values as Record<string, string>));
  const links = await unsubscribeLinks(r.email);
  const company = sender.from.replace(/\s*<[^>]*>\s*$/, "") || sender.from;
  const ctx = { sender: company, unsubscribeUrl: links.url };
  return {
    from: sender.from,
    to: [r.email],
    subject: c.subject,
    html: renderEmailHtml(c, ctx),
    text: renderEmailText(c, ctx),
    ...(sender.replyTo ? { reply_to: sender.replyTo } : {}),
    headers: links.headers,
  };
}

/** Por qué pausar el envío para cuidar el dominio; null si va bien. */
async function reputationProblem(broadcastId: string): Promise<string | null> {
  const where = { emailBroadcastId: broadcastId, status: "SENT" as const };
  const [sent, bounced, complained] = await Promise.all([
    db.emailRecipient.count({ where }),
    db.emailRecipient.count({ where: { ...where, bouncedAt: { not: null } } }),
    db.emailRecipient.count({ where: { ...where, complainedAt: { not: null } } }),
  ]);
  if (sent < REPUTATION_MIN_SENT) return null;
  if (bounced / sent > MAX_BOUNCE_RATE) {
    return `Se pausó solo: rebotó el ${Math.round((bounced / sent) * 100)}% de los correos. Revisa que la lista esté al día antes de seguir.`;
  }
  if (complained / sent > MAX_COMPLAINT_RATE) {
    return `Se pausó solo: ${complained} personas lo marcaron como spam. Revisa que la lista sea de personas que aceptaron recibir tus correos.`;
  }
  return null;
}

/**
 * Envía la siguiente tanda de cada envío por correo en curso, mientras quede cupo del día. Cada
 * persona se "toma" con una condición, así el cron y el envío que parte al crear nunca le
 * escriben dos veces.
 */
export async function runEmailBroadcasts(
  { sender: batchSender = companyResendBatchSender, deadline = Date.now() + 240_000 }: { sender?: EmailBatchSender; deadline?: number } = {},
): Promise<EmailBroadcastRun> {
  const result: EmailBroadcastRun = { sent: 0, skipped: 0 };
  await db.emailRecipient.updateMany({
    where: { status: "SENDING", updatedAt: { lt: new Date(Date.now() - STUCK_MS) } },
    data: { status: "FAILED", error: "El envío se interrumpió: puede que el correo sí haya salido." },
  });
  await db.emailBroadcast.updateMany({ where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } }, data: { status: "SENDING" } });
  const active = await db.emailBroadcast.findMany({ where: { status: "SENDING" }, orderBy: { createdAt: "asc" } });
  if (!active.length) return result;
  const sender = await companyEmailSender();

  for (const b of active) {
    const pause = async (note: string) => {
      await db.emailBroadcast.updateMany({ where: { id: b.id, status: "SENDING" }, data: { status: "PAUSED", note } });
      result.reason = note;
    };
    if (!sender) {
      await pause("El dominio de envío ya no está verificado: revísalo en Configuración → Canales → Correo.");
      continue;
    }
    const base = contentOf(b);
    const contents = [base, b.subjectB ? { ...base, subject: b.subjectB } : base];
    while (Date.now() < deadline) {
      const problem = await reputationProblem(b.id);
      if (problem) {
        await pause(problem);
        break;
      }
      const used = await db.emailRecipient.count({ where: { status: "SENT", sentAt: { gte: new Date(Date.now() - DAY_MS) } } });
      const room = b.dailyLimit - used;
      if (room <= 0) {
        result.reason = "Se llegó al máximo de correos por día; sigue mañana.";
        break;
      }
      const current = await db.emailBroadcast.findUnique({ where: { id: b.id }, select: { status: true } });
      if (current?.status !== "SENDING") break;
      const next = await db.emailRecipient.findMany({
        where: { emailBroadcastId: b.id, status: "PENDING" },
        orderBy: { id: "asc" },
        take: Math.min(RESEND_BATCH_MAX, room),
        select: { id: true },
      });
      if (!next.length) {
        const left = await db.emailRecipient.count({ where: { emailBroadcastId: b.id, status: { in: ["PENDING", "SENDING"] } } });
        if (!left) await db.emailBroadcast.updateMany({ where: { id: b.id, status: "SENDING" }, data: { status: "DONE", finishedAt: new Date() } });
        break;
      }
      const claimed = await db.emailRecipient.updateManyAndReturn({
        where: { id: { in: next.map((r) => r.id) }, status: "PENDING" },
        data: { status: "SENDING" },
      });
      if (!claimed.length) continue;
      // Pudo darse de baja o rebotar en otro envío desde que se armó la lista.
      const suppressed = await suppressedAmong(claimed.map((r) => r.email));
      const skip = claimed.filter((r) => suppressed.has(r.email));
      if (skip.length) {
        await db.emailRecipient.updateMany({ where: { id: { in: skip.map((r) => r.id) } }, data: { status: "SKIPPED", error: "Se dio de baja, rebotó o marcó spam." } });
        result.skipped += skip.length;
      }
      const batch = claimed.filter((r) => !suppressed.has(r.email));
      if (!batch.length) continue;
      try {
        const emails = await Promise.all(batch.map((r) => buildEmail(contents[r.variant] ?? base, sender, r)));
        const ids = await batchSender.sendBatch(emails, `${b.id}-${batch[0].id}-${batch.length}`);
        const sentAt = new Date();
        await db.$transaction(batch.map((r, i) => db.emailRecipient.update({ where: { id: r.id }, data: { status: "SENT", sentAt, resendId: ids[i], error: null } })));
        result.sent += batch.length;
      } catch (err) {
        // Falló la tanda completa (clave, cuenta o límite de Resend): vuelve a la fila y se pausa.
        await db.emailRecipient.updateMany({ where: { id: { in: batch.map((r) => r.id) }, status: "SENDING" }, data: { status: "PENDING" } });
        if (!(err instanceof EmailError)) console.error(`[correos] envío ${b.id}:`, err);
        await pause(err instanceof EmailError ? err.message.replace(/\.?$/, ".") : "No se pudieron enviar los correos.");
        break;
      }
    }
  }
  return result;
}

/** Correo de prueba a alguien del equipo: no queda en el envío. */
export async function sendEmailBroadcastTest(input: EmailBroadcastInput, to: string, { sender: one = companyResendSender as EmailSender, testerName = "" } = {}) {
  const address = normalizeEmail(to);
  if (!EMAIL_RE.test(address)) throw new DomainError("Escribe un correo válido para la prueba.");
  const invalid = contentError(input);
  if (invalid) throw new DomainError(invalid);
  const sender = await companyEmailSender();
  if (!sender) throw new DomainError("Primero conecta y verifica tu dominio en Configuración → Canales → Correo.");
  const audit = await auditEmailAudience(input.audience).catch(() => null);
  const sample = audit?.recipients[0];
  const email = await buildEmail(input, sender, { email: address, name: sample?.name || testerName, values: sample?.values ?? {} });
  try {
    await one.send({ ...email, subject: `[Prueba] ${email.subject}` });
  } catch (e) {
    if (e instanceof EmailError) throw new DomainError(e.message);
    throw e;
  }
  return address;
}

// --- Resultados ---------------------------------------------------------------------------

export type EmailBroadcastStats = {
  total: number;
  pending: number;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  complained: number;
  unsubscribed: number;
  failed: number;
  skipped: number;
};

export const EMPTY_EMAIL_STATS: EmailBroadcastStats = {
  total: 0,
  pending: 0,
  sent: 0,
  delivered: 0,
  opened: 0,
  clicked: 0,
  bounced: 0,
  complained: 0,
  unsubscribed: 0,
  failed: 0,
  skipped: 0,
};

export async function emailBroadcastStats(ids: string[]): Promise<Map<string, EmailBroadcastStats>> {
  if (!ids.length) return new Map();
  const companyId = await currentCompanyId();
  const rows = await db.$queryRaw<({ id: string } & Record<keyof EmailBroadcastStats, number>)[]>`
    SELECT r."emailBroadcastId" AS id,
      count(*)::int AS total,
      count(*) FILTER (WHERE r.status IN ('PENDING', 'SENDING'))::int AS pending,
      count(*) FILTER (WHERE r.status = 'SENT')::int AS sent,
      count(*) FILTER (WHERE r."deliveredAt" IS NOT NULL)::int AS delivered,
      count(*) FILTER (WHERE r."openedAt" IS NOT NULL)::int AS opened,
      count(*) FILTER (WHERE r."clickedAt" IS NOT NULL)::int AS clicked,
      count(*) FILTER (WHERE r."bouncedAt" IS NOT NULL)::int AS bounced,
      count(*) FILTER (WHERE r."complainedAt" IS NOT NULL)::int AS complained,
      count(*) FILTER (WHERE r.status = 'SENT' AND EXISTS (
        SELECT 1 FROM "EmailSuppression" s
        WHERE s."companyId" = r."companyId" AND s.email = r.email AND s.reason = 'UNSUBSCRIBED' AND s."createdAt" >= r."sentAt"
      ))::int AS unsubscribed,
      count(*) FILTER (WHERE r.status = 'FAILED')::int AS failed,
      count(*) FILTER (WHERE r.status = 'SKIPPED')::int AS skipped
    FROM "EmailRecipient" r
    WHERE r."companyId" = ${companyId} AND r."emailBroadcastId" IN (${Prisma.join(ids)})
    GROUP BY r."emailBroadcastId"`;
  return new Map(rows.map(({ id, ...s }) => [id, s]));
}

export const EMAIL_RECIPIENT_FILTERS = {
  todos: "Todos",
  abrieron: "Abrieron",
  clic: "Hicieron clic",
  rebotaron: "Rebotaron",
  fallaron: "Fallaron o se saltaron",
} as const;

export type EmailRecipientFilter = keyof typeof EMAIL_RECIPIENT_FILTERS;

export function emailBroadcastRecipients(emailBroadcastId: string, filter: EmailRecipientFilter = "todos", take = 200) {
  const where: Prisma.EmailRecipientWhereInput = { emailBroadcastId };
  if (filter === "abrieron") where.openedAt = { not: null };
  if (filter === "clic") where.clickedAt = { not: null };
  if (filter === "rebotaron") where.OR = [{ bouncedAt: { not: null } }, { complainedAt: { not: null } }];
  if (filter === "fallaron") where.status = { in: ["FAILED", "SKIPPED"] };
  return db.emailRecipient.findMany({ where, orderBy: [{ sentAt: { sort: "desc", nulls: "last" } }, { email: "asc" }], take });
}

export type EmailVariantStats = { variant: number; subject: string; sent: number; delivered: number; opened: number; clicked: number };

/**
 * Resultados de la prueba A/B: cuántos abrieron cada asunto y cuál va ganando. El ganador se
 * nombra recién cuando los dos tienen al menos AB_MIN_DELIVERED entregados.
 */
export async function emailAbResults(b: Pick<EmailBroadcast, "id" | "subject" | "subjectB">) {
  if (!b.subjectB) return null;
  const rows = await db.emailRecipient.groupBy({
    by: ["variant"],
    where: { emailBroadcastId: b.id, status: "SENT" },
    _count: { _all: true, deliveredAt: true, openedAt: true, clickedAt: true },
  });
  const variants: EmailVariantStats[] = [0, 1].map((variant) => {
    const r = rows.find((x) => x.variant === variant);
    return {
      variant,
      subject: variant ? b.subjectB! : b.subject,
      sent: r?._count._all ?? 0,
      delivered: r?._count.deliveredAt ?? 0,
      opened: r?._count.openedAt ?? 0,
      clicked: r?._count.clickedAt ?? 0,
    };
  });
  const rate = (v: EmailVariantStats) => (v.delivered ? v.opened / v.delivered : 0);
  const ready = variants.every((v) => v.delivered >= AB_MIN_DELIVERED);
  const [a, bb] = variants;
  const winner = !ready || rate(a) === rate(bb) ? null : rate(a) > rate(bb) ? 0 : 1;
  return { variants, ready, winner };
}

/** Cuántas personas de un envío no lo abrieron (para reenviarles). */
export function emailNonOpenersCount(emailBroadcastId: string) {
  return db.emailRecipient.count({ where: notOpened(emailBroadcastId) });
}
