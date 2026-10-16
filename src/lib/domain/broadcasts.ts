import { Prisma, type Broadcast, type BroadcastRecipient, type LeadStatus } from "@prisma/client";
import { db, isDuplicate } from "../db";
import { currentCompanyId } from "../tenant";
import { credential } from "../credentials";
import { randomUUID } from "node:crypto";
import { ChannelSendError, cloudApi, type TemplateMessage, type WhatsAppApi } from "../channels/whatsapp";
import { fileKind, type FileKind } from "../media";
import { estimateCost } from "./broadcast-pricing";
import { parseLocalDateTime } from "../dates";
import { getChannelSettings } from "./channels";
import { normalizePhone } from "./contact-import";
import { whatsappPhoneIds } from "./whatsapp-numbers";
import { addTag, createLead, DomainError } from "./leads";

/**
 * Envíos masivos: una plantilla de WhatsApp aprobada en Meta a una lista de personas. Cada una
 * queda con contacto y lead (el abierto que ya tenía, o uno nuevo en la etapa elegida), así que si
 * responde, la conversación sigue en Chats como cualquier otra. Sale por tandas desde el cron (y
 * apenas se crea), sin pasar el máximo diario que Meta permite al número.
 */

export const MAX_RECIPIENTS = 10_000;
/** Personas que se toman de una vez, y cuántas se envían en paralelo dentro de la tanda. */
const BATCH = 25;
const CONCURRENCY = 5;
/** Tiempo de una corrida (el cron tiene 300 s, compartidos entre todas las empresas). */
export const RUN_BUDGET_MS = 240_000;
/** Una persona que quedó "enviando" más que esto se cortó a medias (ej. se cayó el servidor). */
const STUCK_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Errores de Meta que fallarían con todos: el envío se pausa en vez de seguir. */
const FATAL_CODES = new Set([190, 131031, 132000, 132001, 132015, 132016]);

// --- Variables y destinatarios -----------------------------------------------------------

/** De dónde sale cada variable {{n}}: el primer nombre, una columna del archivo o un texto fijo. */
export type VariableMapping =
  | { source: "name"; fallback?: string }
  | { source: "column"; column: string; fallback?: string }
  | { source: "text"; text: string };

/** Una fila del archivo o de los números pegados. `values` son las columnas que usan las variables. */
export type RecipientRow = { phone: string; name?: string; values?: Record<string, string> };

export type Audience =
  | { kind: "rows"; rows: RecipientRow[]; countryCode?: string }
  | { kind: "funnel"; funnelId: string; stageId?: string | null; status?: LeadStatus | "ALL"; tagId?: string | null }
  /** Quienes recibieron otro envío y no lo leyeron (ni respondieron). */
  | { kind: "resend"; broadcastId: string };

export type TemplateRef = {
  name: string;
  language: string;
  body: string;
  params: number;
  /** MARKETING, UTILITY…: para estimar el costo. */
  category?: string;
  /** El encabezado pide una imagen, un video o un documento. */
  header?: FileKind | null;
  /** Posición de los botones de enlace con parte variable. */
  urlButtons?: number[];
};

/** Plantilla con sus datos: el envío normal, o cada lado de una prueba A/B. */
export type TemplateFill = {
  template: TemplateRef;
  variables: VariableMapping[];
  /** Parte variable de cada botón de enlace, en el orden de `template.urlButtons`. */
  buttonVariables?: VariableMapping[];
  /** Archivo de la biblioteca (Configuración → Conocimiento → Archivos) para el encabezado. */
  headerFileId?: string | null;
};

export type Exclusions = {
  /** Sin teléfono o con uno que no parece de WhatsApp (o sin código de país). */
  invalid: number;
  duplicate: number;
  blocked: number;
  /** Pidieron no recibir más envíos (respondieron "BAJA", "no me interesa"…). */
  optedOut: number;
  /** Escribieron en las últimas 24 horas: ya están conversando con el equipo o la IA. */
  active: number;
  /** Les falta un dato que la plantilla necesita y no hay texto de reemplazo. */
  missing: number;
};

/** `fills[i]` son los valores (cuerpo y luego botones) para la plantilla i del envío. */
export type ResolvedRecipient = { phone: string; name: string; fills: string[][] };

export type Audit = { total: number; excluded: Exclusions; recipients: ResolvedRecipient[] };

const firstName = (name: string) => {
  const n = name.trim();
  // Un contacto sin nombre se guarda con su número: no sirve como nombre.
  return /^\+?\d[\d\s]*$/.test(n) ? "" : (n.split(/\s+/)[0] ?? "");
};

/** Valor de cada variable para una persona; null si falta uno y no hay reemplazo. */
export function resolveParams(variables: VariableMapping[], row: { name: string; values?: Record<string, string> }): string[] | null {
  const params: string[] = [];
  for (const v of variables) {
    const raw =
      v.source === "text" ? v.text : v.source === "name" ? firstName(row.name) : (row.values?.[v.column] ?? "");
    // Meta rechaza variables vacías o con saltos de línea.
    const value = (raw.trim() || ("fallback" in v ? (v.fallback ?? "").trim() : "")).replace(/\s*\n\s*/g, " ");
    if (!value) return null;
    params.push(value);
  }
  return params;
}

/** Texto del mensaje con las variables reemplazadas, como queda en el chat. */
export function renderBody(body: string, params: string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (all, n: string) => params[Number(n) - 1] ?? all);
}

async function audienceRows(audience: Audience): Promise<{ rows: { phone: string | null; name: string; values?: Record<string, string> }[] }> {
  if (audience.kind === "rows") {
    return {
      rows: audience.rows.map((r) => ({
        phone: normalizePhone(String(r.phone ?? ""), audience.countryCode ?? ""),
        name: String(r.name ?? "").trim(),
        values: r.values,
      })),
    };
  }
  if (audience.kind === "resend") {
    const rows = await db.$queryRaw<{ phone: string; name: string }[]>`
      SELECT phone, name FROM (${STATE_SQL(await currentCompanyId())} AND r."broadcastId" = ${audience.broadcastId}) s
      WHERE state IN ('SENT', 'DELIVERED')
      ORDER BY name`;
    return { rows };
  }
  if (!(await db.funnel.count({ where: { id: audience.funnelId } }))) throw new DomainError("Ese embudo no existe.");
  const leads = await db.lead.findMany({
    where: {
      stage: { funnelId: audience.funnelId, ...(audience.stageId ? { id: audience.stageId } : {}) },
      ...(audience.status && audience.status !== "ALL" ? { status: audience.status } : {}),
      contact: {
        channel: "WHATSAPP",
        externalId: { not: null },
        ...(audience.tagId ? { tags: { some: { tagId: audience.tagId } } } : {}),
      },
    },
    select: { contact: { select: { externalId: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: MAX_RECIPIENTS * 2,
  });
  return { rows: leads.map((l) => ({ phone: l.contact.externalId, name: l.contact.name })) };
}

/**
 * A quiénes les llegaría el envío y a quiénes se deja fuera (y por qué). Se calcula igual al
 * revisar (paso 3) y al crear el envío.
 */
export async function auditAudience(audience: Audience, variableSets: VariableMapping[][], now = new Date()): Promise<Audit> {
  const { rows } = await audienceRows(audience);
  const excluded: Exclusions = { invalid: 0, duplicate: 0, blocked: 0, optedOut: 0, active: 0, missing: 0 };
  const seen = new Set<string>();
  const valid: { phone: string; name: string; values?: Record<string, string> }[] = [];
  for (const r of rows) {
    if (!r.phone) excluded.invalid++;
    else if (seen.has(r.phone)) excluded.duplicate++;
    else {
      seen.add(r.phone);
      valid.push({ ...r, phone: r.phone });
    }
  }
  const contacts = await db.contact.findMany({
    where: { channel: "WHATSAPP", externalId: { in: valid.map((r) => r.phone) } },
    select: { id: true, externalId: true, name: true, blockedAt: true, optedOutAt: true },
  });
  const byPhone = new Map(contacts.map((c) => [c.externalId!, c]));
  const recentlyActive = new Set(
    (
      await db.message.findMany({
        where: { author: "CONTACT", createdAt: { gte: new Date(now.getTime() - DAY_MS) }, lead: { contactId: { in: contacts.map((c) => c.id) } } },
        select: { lead: { select: { contactId: true } } },
        distinct: ["leadId"],
      })
    ).map((m) => m.lead.contactId),
  );

  const recipients: ResolvedRecipient[] = [];
  for (const r of valid) {
    const contact = byPhone.get(r.phone);
    if (contact?.blockedAt) {
      excluded.blocked++;
      continue;
    }
    if (contact?.optedOutAt) {
      excluded.optedOut++;
      continue;
    }
    if (contact && recentlyActive.has(contact.id)) {
      excluded.active++;
      continue;
    }
    const name = r.name || contact?.name || `+${r.phone}`;
    const fills = variableSets.map((vars) => resolveParams(vars, { name, values: r.values }));
    if (fills.some((f) => !f)) {
      excluded.missing++;
      continue;
    }
    recipients.push({ phone: r.phone, name, fills: fills as string[][] });
  }
  return { total: rows.length, excluded, recipients };
}

// --- Crear ----------------------------------------------------------------------------------

export type BroadcastInput = TemplateFill & {
  name: string;
  audience: Audience;
  /** Segunda plantilla para una prueba A/B: la lista se reparte al azar en dos mitades. */
  variantB?: TemplateFill | null;
  fromPhoneNumberId?: string | null;
  stageId: string;
  tagId?: string | null;
  dailyLimit: number;
  /** Fecha y hora de Chile ("AAAA-MM-DDTHH:MM") en que parte; vacío parte al confirmar. */
  scheduledAt?: string | null;
};

const MAX_SCHEDULE_MS = 60 * DAY_MS;

/** Cuándo parte el envío programado; null si parte ahora. */
function scheduleOf(input: BroadcastInput, now = new Date()): Date | null {
  if (!input.scheduledAt?.trim()) return null;
  const at = parseLocalDateTime(input.scheduledAt);
  if (!at) throw new DomainError("Revisa la fecha y hora del envío.");
  if (at.getTime() < now.getTime() + 60_000) throw new DomainError("La fecha y hora del envío ya pasó: elige una más adelante.");
  if (at.getTime() > now.getTime() + MAX_SCHEDULE_MS) throw new DomainError("Se puede programar hasta 60 días hacia adelante.");
  return at;
}

type HeaderFile = { url: string; mimeType: string; fileName: string };

/** Revisa una plantilla con sus datos y busca el archivo del encabezado. */
async function validateFill(fill: TemplateFill, label: string): Promise<HeaderFile | null> {
  const t = fill.template;
  if (!t.name || !t.language) throw new DomainError(`Elige ${label}.`);
  if (fill.variables.length !== t.params) throw new DomainError("Indica de dónde sale cada variable de la plantilla.");
  if ((fill.buttonVariables ?? []).length !== (t.urlButtons ?? []).length) throw new DomainError("Indica el final del enlace de cada botón.");
  if (!t.header) return null;
  const file = fill.headerFileId ? await db.mediaFile.findUnique({ where: { id: fill.headerFileId } }) : null;
  const names = { image: "una imagen", video: "un video", document: "un documento" } as const;
  if (!file) throw new DomainError(`La plantilla lleva ${names[t.header]} arriba: elige el archivo.`);
  // WhatsApp solo acepta JPEG o PNG como imagen y MP4 como video.
  if (t.header !== "document" && fileKind(file.mimeType) !== t.header) {
    throw new DomainError(t.header === "image" ? "La imagen tiene que ser JPG o PNG." : "El video tiene que ser MP4.");
  }
  return { url: file.url, mimeType: file.mimeType, fileName: file.fileName };
}

/** Variables del cuerpo y luego las de los botones: así se guardan juntas por persona. */
const allVariables = (f: TemplateFill) => [...f.variables, ...(f.buttonVariables ?? [])];
const fills = (input: BroadcastInput) => [input, ...(input.variantB ? [input.variantB] : [])];

async function validate(input: BroadcastInput) {
  if (!input.name.trim()) throw new DomainError("Ponle un nombre al envío.");
  const headers = [await validateFill(input, "una plantilla aprobada")];
  if (input.variantB) {
    headers.push(await validateFill(input.variantB, "la segunda plantilla de la prueba A/B"));
    const b = input.variantB.template;
    if (b.name === input.template.name && b.language === input.template.language) {
      throw new DomainError("Para la prueba A/B elige dos plantillas distintas.");
    }
  }
  if (!Number.isInteger(input.dailyLimit) || input.dailyLimit < 1 || input.dailyLimit > 1_000_000) {
    throw new DomainError("El máximo por día tiene que ser un número mayor que cero.");
  }
  if (!(await db.stage.count({ where: { id: input.stageId } }))) throw new DomainError("Elige la etapa donde quedan los leads.");
  if (input.tagId && !(await db.tag.count({ where: { id: input.tagId } }))) throw new DomainError("Esa etiqueta no existe.");
  if (input.fromPhoneNumberId && !(await whatsappPhoneIds()).includes(input.fromPhoneNumberId)) {
    throw new DomainError("Ese número de WhatsApp no está conectado.");
  }
  return { scheduledAt: scheduleOf(input), headers };
}

/** Reparte la lista al azar: con A/B, la mitad recibe cada plantilla (`fill` 0 o 1). */
function assignVariants(recipients: ResolvedRecipient[], variants: number) {
  const order = recipients.map((r) => ({ r, k: Math.random() })).sort((a, b) => a.k - b.k);
  return order.map(({ r }, i) => ({ ...r, variant: i % variants }));
}

/** Revisión del paso 3: sin guardar nada. */
export async function previewBroadcast(input: BroadcastInput) {
  await validate(input);
  const audit = await auditAudience(input.audience, fills(input).map(allVariables));
  const first = audit.recipients[0];
  const sample = (f: TemplateFill, i: number) => (first ? renderBody(f.template.body, first.fills[i].slice(0, f.template.params)) : null);
  const assigned = assignVariants(audit.recipients, fills(input).length);
  return {
    total: audit.total,
    excluded: audit.excluded,
    count: audit.recipients.length,
    sample: first ? { name: first.name, body: sample(input, 0)!, bodyB: input.variantB ? sample(input.variantB, 1) : null } : null,
    /** USD aproximados según el país de cada persona y la categoría de la plantilla. */
    cost: estimateCost(assigned.map((r) => ({ phone: r.phone, category: fills(input)[r.variant].template.category ?? "MARKETING" }))),
  };
}

/** Crea el envío con sus destinatarios; queda enviándose o, si tiene fecha, programado (ver runBroadcasts). */
export async function createBroadcast(input: BroadcastInput, userId: string): Promise<Broadcast> {
  const { scheduledAt, headers } = await validate(input);
  const { recipients } = await auditAudience(input.audience, fills(input).map(allVariables));
  if (!recipients.length) throw new DomainError("No queda nadie a quien enviarle: revisa los números y las exclusiones.");
  if (recipients.length > MAX_RECIPIENTS) {
    throw new DomainError(`Un envío puede tener hasta ${MAX_RECIPIENTS.toLocaleString("es-CL")} personas: divide la lista.`);
  }
  const variants = fills(input);
  if (input.variantB && recipients.length < 2) throw new DomainError("Para una prueba A/B hacen falta al menos dos personas.");
  const assigned = assignVariants(recipients, variants.length);
  const abGroup = input.variantB ? randomUUID() : null;
  return db.$transaction(
    async (tx) => {
      const created: Broadcast[] = [];
      for (const [v, fill] of variants.entries()) {
        const header = headers[v];
        const broadcast = await tx.broadcast.create({
          data: {
            name: input.name.trim() + (abGroup ? ` · ${v ? "B" : "A"}` : ""),
            templateName: fill.template.name,
            templateLanguage: fill.template.language,
            templateText: fill.template.body,
            templateCategory: fill.template.category ?? "",
            headerUrl: header?.url ?? null,
            headerMimeType: header?.mimeType ?? null,
            headerFileName: header?.fileName ?? null,
            buttonIndexes: fill.template.urlButtons ?? [],
            abGroup,
            resentFromId: input.audience.kind === "resend" ? input.audience.broadcastId : null,
            fromPhoneNumberId: input.fromPhoneNumberId || null,
            stageId: input.stageId,
            tagId: input.tagId || null,
            dailyLimit: input.dailyLimit,
            createdById: userId,
            ...(scheduledAt ? { status: "SCHEDULED" as const, scheduledAt } : {}),
          },
        });
        created.push(broadcast);
        const mine = assigned.filter((r) => r.variant === v);
        for (let i = 0; i < mine.length; i += 1000) {
          await tx.broadcastRecipient.createMany({
            data: mine.slice(i, i + 1000).map((r) => ({
              broadcastId: broadcast.id,
              phone: r.phone,
              name: r.name,
              params: r.fills[v].slice(0, fill.template.params),
              buttonParams: r.fills[v].slice(fill.template.params),
            })),
          });
        }
      }
      return created[0];
    },
    { timeout: 60_000 },
  );
}

// --- Pausar, seguir, cancelar -----------------------------------------------------------

/** Una prueba A/B se maneja junta: pausar, seguir o cancelar una mitad hace lo mismo con la otra. */
async function withGroup(id: string): Promise<string[]> {
  const b = await db.broadcast.findUnique({ where: { id }, select: { abGroup: true } });
  if (!b?.abGroup) return [id];
  return (await db.broadcast.findMany({ where: { abGroup: b.abGroup }, select: { id: true } })).map((x) => x.id);
}

export async function pauseBroadcast(id: string) {
  await db.broadcast.updateMany({ where: { id: { in: await withGroup(id) }, status: "SENDING" }, data: { status: "PAUSED", note: null } });
}

export async function resumeBroadcast(id: string) {
  await db.broadcast.updateMany({ where: { id: { in: await withGroup(id) }, status: "PAUSED" }, data: { status: "SENDING", note: null } });
}

/** Un envío programado parte ya, sin esperar su hora. */
export async function sendBroadcastNow(id: string) {
  await db.broadcast.updateMany({ where: { id: { in: await withGroup(id) }, status: "SCHEDULED" }, data: { status: "SENDING", scheduledAt: new Date() } });
}

/** Cancela lo que falta por enviar; lo ya enviado queda. */
export async function cancelBroadcast(id: string) {
  const ids = await withGroup(id);
  await db.$transaction(async (tx) => {
    const { count } = await tx.broadcast.updateMany({
      where: { id: { in: ids }, status: { in: ["SCHEDULED", "SENDING", "PAUSED"] } },
      data: { status: "CANCELED", finishedAt: new Date() },
    });
    if (count) {
      await tx.broadcastRecipient.updateMany({
        where: { broadcastId: { in: ids }, status: "PENDING", broadcast: { status: "CANCELED" } },
        data: { status: "SKIPPED", error: "Se canceló el envío." },
      });
    }
  });
}

// --- Enviar ---------------------------------------------------------------------------------

export type BroadcastRun = { sent: number; failed: number; skipped: number; reason?: string };

type Outcome = "sent" | "failed" | "skipped" | { fatal: string };

/**
 * Envía la siguiente tanda de cada envío en curso, del más antiguo al más nuevo, mientras quede
 * cupo del día. Cada persona se "toma" con una condición, así el cron y el envío que parte al
 * crear nunca le escriben dos veces.
 */
export async function runBroadcasts(
  { api = cloudApi, deadline = Date.now() + RUN_BUDGET_MS }: { api?: WhatsAppApi; deadline?: number } = {},
): Promise<BroadcastRun> {
  const result: BroadcastRun = { sent: 0, failed: 0, skipped: 0 };
  await failStuck();
  // Los programados cuya hora llegó parten en esta corrida.
  await db.broadcast.updateMany({ where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } }, data: { status: "SENDING" } });
  const active = await db.broadcast.findMany({ where: { status: "SENDING" }, orderBy: { createdAt: "asc" } });
  if (!active.length) return result;
  const { whatsappAi } = await getChannelSettings();

  for (const b of active) {
    const missing = api === cloudApi ? await missingSendCredentials(b.fromPhoneNumberId) : null;
    if (missing) {
      await db.broadcast.updateMany({ where: { id: b.id, status: "SENDING" }, data: { status: "PAUSED", note: missing } });
      result.reason = missing;
      continue;
    }
    while (Date.now() < deadline) {
      const used = await db.broadcastRecipient.count({ where: { status: "SENT", sentAt: { gte: new Date(Date.now() - DAY_MS) } } });
      const room = b.dailyLimit - used;
      if (room <= 0) {
        result.reason = "Se llegó al máximo de personas por día; sigue mañana.";
        break;
      }
      const current = await db.broadcast.findUnique({ where: { id: b.id }, select: { status: true } });
      if (current?.status !== "SENDING") break;
      const batch = await db.broadcastRecipient.findMany({
        where: { broadcastId: b.id, status: "PENDING" },
        orderBy: { id: "asc" },
        take: Math.min(BATCH, room),
      });
      if (!batch.length) {
        await finishIfDone(b.id);
        break;
      }
      let fatal: string | null = null;
      for (let i = 0; i < batch.length && !fatal; i += CONCURRENCY) {
        const outcomes = await Promise.all(batch.slice(i, i + CONCURRENCY).map((r) => sendRecipient(b, r, api, whatsappAi)));
        for (const o of outcomes) {
          if (typeof o === "object") fatal = o.fatal;
          else result[o]++;
        }
      }
      if (fatal) {
        await db.broadcast.updateMany({ where: { id: b.id, status: "SENDING" }, data: { status: "PAUSED", note: fatal } });
        result.reason = fatal;
        break;
      }
    }
  }
  return result;
}

/** Sin token o sin número no sale nada: se pausa antes de crear leads. */
async function missingSendCredentials(fromPhoneNumberId: string | null): Promise<string | null> {
  if (!(await credential("WHATSAPP_TOKEN"))) return "Falta el token de WhatsApp en Configuración → Credenciales.";
  if (!fromPhoneNumberId && !(await credential("WHATSAPP_PHONE_NUMBER_ID"))) {
    return "Falta el id del número de WhatsApp en Configuración → Credenciales.";
  }
  return null;
}

async function finishIfDone(broadcastId: string) {
  const left = await db.broadcastRecipient.count({ where: { broadcastId, status: { in: ["PENDING", "SENDING"] } } });
  if (!left) await db.broadcast.updateMany({ where: { id: broadcastId, status: "SENDING" }, data: { status: "DONE", finishedAt: new Date() } });
}

/** Quien quedó "enviando" por un corte no se reintenta: puede que el mensaje sí haya salido. */
async function failStuck() {
  await db.broadcastRecipient.updateMany({
    where: { status: "SENDING", updatedAt: { lt: new Date(Date.now() - STUCK_MS) } },
    data: { status: "FAILED", error: "El envío se interrumpió: revisa su chat antes de volver a escribirle." },
  });
}

/**
 * Lead al que va el mensaje, o por qué ya no se le envía: desde que se armó la lista (el envío
 * pudo estar programado o esperando cupo) pudo bloquearse, pedir la baja o ponerse a conversar.
 */
async function leadFor(b: Broadcast, r: BroadcastRecipient, aiEnabled: boolean): Promise<{ leadId: string } | { skip: string }> {
  const find = () =>
    db.contact.findFirst({
      where: { channel: "WHATSAPP", externalId: r.phone },
      include: { leads: { where: { status: "OPEN" }, orderBy: { createdAt: "desc" }, take: 1 } },
    });
  const contact = await find();
  if (contact?.blockedAt) return { skip: "El contacto está bloqueado." };
  if (contact?.optedOutAt) return { skip: "Pidió no recibir más envíos." };
  if (contact) {
    const talking = await db.message.count({
      where: { author: "CONTACT", lead: { contactId: contact.id }, createdAt: { gte: new Date(Date.now() - DAY_MS) } },
    });
    if (talking) return { skip: "Escribió en las últimas 24 horas: ya está conversando." };
  }
  // Quien ya tiene un lead abierto sigue en su etapa: el envío no lo hace retroceder.
  if (contact?.leads[0]) return { leadId: contact.leads[0].id };
  const options = { aiEnabled, stageId: b.stageId };
  try {
    const lead = contact
      ? await createLead({ contactId: contact.id }, options)
      : await createLead({ name: r.name, channel: "WHATSAPP", phone: `+${r.phone}`, externalId: r.phone }, options);
    return { leadId: lead.id };
  } catch (err) {
    // La persona escribió justo ahora y el webhook creó su contacto o su lead.
    const open = isDuplicate(err) ? (await find())?.leads[0] : null;
    if (!open) throw err;
    return { leadId: open.id };
  }
}

async function sendRecipient(b: Broadcast, r: BroadcastRecipient, api: WhatsAppApi, aiEnabled: boolean): Promise<Outcome> {
  const claimed = await db.broadcastRecipient.updateMany({ where: { id: r.id, status: "PENDING" }, data: { status: "SENDING" } });
  if (!claimed.count) return "skipped";
  let messageId: string | null = null;
  try {
    const lead = await leadFor(b, r, aiEnabled);
    if ("skip" in lead) {
      await db.broadcastRecipient.update({ where: { id: r.id }, data: { status: "SKIPPED", error: lead.skip } });
      return "skipped";
    }
    const by = { actor: "USER" as const, userId: b.createdById };
    if (b.tagId) await addTag(lead.leadId, b.tagId, by).catch((e) => console.error(`[envíos] etiqueta, lead ${lead.leadId}:`, e));
    // Si responde, la respuesta del equipo o la IA sale por el mismo número del envío.
    if (b.fromPhoneNumberId) {
      await db.contact.updateMany({ where: { channel: "WHATSAPP", externalId: r.phone }, data: { waPhoneNumberId: b.fromPhoneNumberId } });
    }
    const message = await db.message.create({
      data: {
        leadId: lead.leadId,
        author: "USER",
        userId: b.createdById,
        body: renderBody(b.templateText, r.params),
        deliveryStatus: "SENDING",
        ...(b.headerUrl ? { mediaUrl: b.headerUrl, mediaType: b.headerMimeType, mediaName: b.headerFileName } : {}),
      },
    });
    messageId = message.id;
    await db.broadcastRecipient.update({ where: { id: r.id }, data: { leadId: lead.leadId, messageId } });
    if (!api.sendTemplate) throw new ChannelSendError("WhatsApp no permite enviar plantillas con esta conexión.");
    const externalId = await api.sendTemplate(r.phone, templateMessage(b, r.params, r.buttonParams), b.fromPhoneNumberId ?? undefined);
    await markSent(r.id, messageId, externalId);
    return "sent";
  } catch (err) {
    const known = err instanceof ChannelSendError;
    if (!known) console.error(`[envíos] envío ${b.id}, ${r.phone}:`, err);
    const reason = known ? err.message : "No se pudo enviar por WhatsApp.";
    // Sin código de Meta es un problema de la conexión (ej. falta el token), no de esta persona.
    if (known && (!err.code || FATAL_CODES.has(err.code))) {
      // Fallaría con todos: esta persona vuelve a la fila y el envío se pausa hasta corregirlo.
      if (messageId) await db.message.delete({ where: { id: messageId } }).catch(() => {});
      await db.broadcastRecipient.update({ where: { id: r.id }, data: { status: "PENDING", messageId: null } });
      return { fatal: reason };
    }
    await db.$transaction([
      ...(messageId ? [db.message.update({ where: { id: messageId }, data: { deliveryStatus: "FAILED", deliveryError: reason } })] : []),
      db.broadcastRecipient.update({ where: { id: r.id }, data: { status: "FAILED", error: reason } }),
    ]);
    return "failed";
  }
}

/** Lo que va a WhatsApp: la plantilla con los valores de la persona, el archivo y los botones. */
function templateMessage(
  b: Pick<Broadcast, "templateName" | "templateLanguage" | "headerUrl" | "headerMimeType" | "headerFileName" | "buttonIndexes">,
  params: string[],
  buttonParams: string[],
): TemplateMessage {
  const kind = b.headerUrl ? fileKind(b.headerMimeType) : null;
  return {
    name: b.templateName,
    language: b.templateLanguage,
    params,
    header: b.headerUrl && kind && kind !== "audio" ? { kind, url: b.headerUrl, fileName: b.headerFileName ?? undefined } : null,
    buttons: b.buttonIndexes.map((index, i) => ({ index, text: buttonParams[i] ?? "" })),
  };
}

/** Ya salió: aunque no se pueda guardar el id de WhatsApp, cuenta como enviado (no se reintenta). */
async function markSent(recipientId: string, messageId: string, externalId: string) {
  const sent = () => db.broadcastRecipient.update({ where: { id: recipientId }, data: { status: "SENT", sentAt: new Date(), error: null } });
  try {
    await db.$transaction([db.message.update({ where: { id: messageId }, data: { deliveryStatus: "SENT", externalId } }), sent()]);
  } catch (err) {
    console.error(`[envíos] mensaje ${messageId} enviado como ${externalId}, sin guardar su id:`, err);
    await db.$transaction([db.message.update({ where: { id: messageId }, data: { deliveryStatus: "SENT" } }), sent()]);
  }
}

// --- Resultados ---------------------------------------------------------------------------

export type BroadcastStats = {
  total: number;
  pending: number;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  failed: number;
  skipped: number;
};

export const EMPTY_STATS: BroadcastStats = { total: 0, pending: 0, sent: 0, delivered: 0, read: 0, replied: 0, failed: 0, skipped: 0 };

/**
 * Estado de cada persona, con los avisos de entrega de WhatsApp de su mensaje. Respondió = le
 * escribió al lead después del envío. Quien respondió cuenta como entregado y leído aunque
 * tenga apagadas las confirmaciones de lectura.
 */
const STATE_SQL = (companyId: string) => Prisma.sql`
  SELECT r.id, r."broadcastId", r.name, r.phone, r."leadId", r."sentAt",
    COALESCE(m."deliveryError", r.error) AS error,
    CASE
      WHEN r.status IN ('PENDING', 'SENDING') THEN 'PENDING'
      WHEN r.status = 'SKIPPED' THEN 'SKIPPED'
      WHEN r.status = 'FAILED' OR m."deliveryStatus" = 'FAILED' THEN 'FAILED'
      WHEN EXISTS (
        SELECT 1 FROM "Message" c
        WHERE c."leadId" = r."leadId" AND c.author = 'CONTACT' AND c."createdAt" > r."sentAt"
      ) THEN 'REPLIED'
      WHEN m."deliveryStatus" = 'READ' THEN 'READ'
      WHEN m."deliveryStatus" = 'DELIVERED' THEN 'DELIVERED'
      ELSE 'SENT'
    END AS state
  FROM "BroadcastRecipient" r
  LEFT JOIN "Message" m ON m.id = r."messageId"
  WHERE r."companyId" = ${companyId}`;

export async function broadcastStats(ids: string[]): Promise<Map<string, BroadcastStats>> {
  if (!ids.length) return new Map();
  const rows = await db.$queryRaw<({ id: string } & BroadcastStats)[]>`
    SELECT s."broadcastId" AS id,
      count(*)::int AS total,
      count(*) FILTER (WHERE state = 'PENDING')::int AS pending,
      count(*) FILTER (WHERE state IN ('SENT', 'DELIVERED', 'READ', 'REPLIED'))::int AS sent,
      count(*) FILTER (WHERE state IN ('DELIVERED', 'READ', 'REPLIED'))::int AS delivered,
      count(*) FILTER (WHERE state IN ('READ', 'REPLIED'))::int AS read,
      count(*) FILTER (WHERE state = 'REPLIED')::int AS replied,
      count(*) FILTER (WHERE state = 'FAILED')::int AS failed,
      count(*) FILTER (WHERE state = 'SKIPPED')::int AS skipped
    FROM (${STATE_SQL(await currentCompanyId())} AND r."broadcastId" IN (${Prisma.join(ids)})) s
    GROUP BY s."broadcastId"`;
  return new Map(rows.map(({ id, ...s }) => [id, s]));
}

export type RecipientState = "PENDING" | "SKIPPED" | "FAILED" | "REPLIED" | "READ" | "DELIVERED" | "SENT";

export const RECIPIENT_FILTERS = {
  todos: null,
  respondieron: ["REPLIED"],
  leidos: ["READ"],
  sin_leer: ["SENT", "DELIVERED"],
  fallaron: ["FAILED", "SKIPPED"],
  pendientes: ["PENDING"],
} as const satisfies Record<string, readonly RecipientState[] | null>;

export type RecipientFilter = keyof typeof RECIPIENT_FILTERS;

export type RecipientRowView = {
  id: string;
  name: string;
  phone: string;
  leadId: string | null;
  sentAt: Date | null;
  error: string | null;
  state: RecipientState;
  stageName: string | null;
  leadStatus: LeadStatus | null;
};

/** Personas del envío con su estado, las enviadas más recientes primero. */
export async function broadcastRecipients(broadcastId: string, filter: RecipientFilter = "todos", take = 200): Promise<RecipientRowView[]> {
  const states = RECIPIENT_FILTERS[filter];
  const rows = await db.$queryRaw<Omit<RecipientRowView, "stageName" | "leadStatus">[]>`
    SELECT * FROM (${STATE_SQL(await currentCompanyId())} AND r."broadcastId" = ${broadcastId}) s
    ${states ? Prisma.sql`WHERE state IN (${Prisma.join([...states])})` : Prisma.empty}
    ORDER BY "sentAt" DESC NULLS LAST, name ASC
    LIMIT ${take}`;
  const leads = await db.lead.findMany({
    where: { id: { in: rows.flatMap((r) => (r.leadId ? [r.leadId] : [])) } },
    select: { id: true, status: true, stage: { select: { name: true } } },
  });
  const byId = new Map(leads.map((l) => [l.id, l]));
  return rows.map((r) => ({ ...r, stageName: byId.get(r.leadId ?? "")?.stage.name ?? null, leadStatus: byId.get(r.leadId ?? "")?.status ?? null }));
}

// --- Prueba y plantillas nuevas -----------------------------------------------------------

/**
 * Envía la plantilla, con los datos de la primera persona de la lista, a un número del equipo
 * para ver cómo llega. No crea contacto, lead ni mensaje en el chat.
 */
export async function sendBroadcastTest(input: BroadcastInput, to: string, { api = cloudApi }: { api?: WhatsAppApi } = {}) {
  const { headers } = await validate(input);
  const phone = normalizePhone(to, input.audience.kind === "rows" ? (input.audience.countryCode ?? "") : "");
  if (!phone) throw new DomainError("Escribe tu número de WhatsApp con código de país, ej. +56 9 1234 5678.");
  const { recipients } = await auditAudience(input.audience, [allVariables(input)]);
  const params = recipients[0]?.fills[0] ?? resolveParams(allVariables(input), { name: "María" });
  if (!params) throw new DomainError("Para la prueba hace falta al menos una persona en la lista con todos los datos.");
  if (api === cloudApi) {
    const missing = await missingSendCredentials(input.fromPhoneNumberId || null);
    if (missing) throw new DomainError(missing);
  }
  if (!api.sendTemplate) throw new DomainError("WhatsApp no permite enviar plantillas con esta conexión.");
  try {
    const header = headers[0];
    const message = templateMessage(
      {
        templateName: input.template.name,
        templateLanguage: input.template.language,
        headerUrl: header?.url ?? null,
        headerMimeType: header?.mimeType ?? null,
        headerFileName: header?.fileName ?? null,
        buttonIndexes: input.template.urlButtons ?? [],
      },
      params.slice(0, input.template.params),
      params.slice(input.template.params),
    );
    await api.sendTemplate(phone, message, input.fromPhoneNumberId || undefined);
  } catch (err) {
    if (err instanceof ChannelSendError) throw new DomainError(err.message);
    throw err;
  }
  return { phone: `+${phone}`, body: renderBody(input.template.body, params.slice(0, input.template.params)) };
}
