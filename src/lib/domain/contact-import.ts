import Papa from "papaparse";
import type { Channel, Contact, Prisma } from "@prisma/client";
import { db } from "../db";
import { CHANNEL_LABEL } from "../labels";
import { normalize } from "../text";
import { displayFieldValue, findField, parseFieldValue } from "./fields";
import { entryStage, stageOptions } from "./funnels";
import { DomainError, type ActorRef } from "./leads";

type Tx = Prisma.TransactionClient;

/** Categoría de las etiquetas que vienen sin "Categoría: nombre" en el CSV. */
export const DEFAULT_TAG_CATEGORY = "General";

const MAX_ROWS = 10_000;
const MAX_ERRORS = 20;

// --- Exportar ----------------------------------------------------------------------------

const STATUS_LABEL = { OPEN: "Abierto", WON: "Ganado", LOST: "Perdido" } as const;

/**
 * Todos los contactos en CSV, con su último lead. Las columnas Nombre, Teléfono, Correo,
 * Etiquetas, Etapa, Ejecutivo y los campos del cliente se pueden volver a importar tal cual.
 */
export async function exportContactsCsv(): Promise<string> {
  const [contacts, fields] = await Promise.all([
    db.contact.findMany({
      where: { channel: { not: "SIMULATOR" } },
      orderBy: { createdAt: "asc" },
      include: {
        tags: { include: { tag: true } },
        fields: true,
        leads: { orderBy: { createdAt: "desc" }, take: 1, include: { stage: { include: { funnel: true } }, assignee: true } },
      },
    }),
    db.customField.findMany({ orderBy: { position: "asc" } }),
  ]);
  const header = ["Nombre", "Teléfono", "Correo", "Canal", "Etiquetas", "Embudo", "Etapa", "Estado", "Ejecutivo", ...fields.map((f) => f.name), "Creado", "Bloqueado"];
  const rows = contacts.map((c) => {
    const lead = c.leads[0];
    const values = new Map(c.fields.map((v) => [v.fieldId, v.value]));
    return [
      c.name,
      c.phone ?? "",
      c.email ?? "",
      CHANNEL_LABEL[c.channel],
      c.tags.map((t) => `${t.tag.category}: ${t.tag.name}`).join("; "),
      lead?.stage.funnel.name ?? "",
      lead?.stage.name ?? "",
      lead ? STATUS_LABEL[lead.status] : "",
      lead?.assignee?.email ?? "",
      ...fields.map((f) => (values.has(f.id) ? displayFieldValue(f, values.get(f.id)!) : "")),
      c.createdAt.toISOString(),
      c.blockedAt ? "Sí" : "",
    ];
  });
  // El BOM hace que Excel abra el archivo con tildes y eñes bien.
  return "﻿" + Papa.unparse([header, ...rows]);
}

// --- Importar ----------------------------------------------------------------------------

/** Solo dígitos, con el código de país; null si no parece un teléfono. */
export function normalizePhone(raw: string, defaultCountryCode = ""): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (!raw.trim().startsWith("+") && defaultCountryCode && digits.length <= 9) digits = defaultCountryCode.replace(/\D/g, "") + digits;
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

const COLUMN_ALIASES: Record<string, string[]> = {
  name: ["nombre", "name", "nombre completo", "cliente", "contacto"],
  phone: ["telefono", "phone", "celular", "movil", "whatsapp", "numero", "fono"],
  email: ["correo", "email", "e mail", "mail", "correo electronico"],
  tags: ["etiquetas", "tags", "etiqueta"],
  stage: ["etapa", "stage", "etapa del funnel"],
  funnel: ["embudo", "funnel", "pipeline"],
  assignee: ["ejecutivo", "asignado", "vendedor", "responsable"],
};

/** Etiquetas escritas como "Interés: alto; Producto: casa" (también separadas por coma o barra). */
export function parseTags(raw: string): { category: string; name: string }[] {
  return raw
    .split(/[;,|]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      const i = t.indexOf(":");
      return i > 0 && t.slice(i + 1).trim()
        ? { category: t.slice(0, i).trim(), name: t.slice(i + 1).trim() }
        : { category: DEFAULT_TAG_CATEGORY, name: t.replace(/:$/, "").trim() };
    });
}

export type ImportResult = { created: number; updated: number; skipped: number; errors: string[] };

/**
 * Importa contactos desde un CSV (primera fila: nombres de columna). Reconoce nombre, teléfono,
 * correo, etiquetas, etapa, ejecutivo y una columna por cada campo del cliente con su mismo
 * nombre. Un contacto que ya existe (mismo WhatsApp o correo) se completa en vez de duplicarse.
 * Cada contacto sin lead abierto queda con uno en la etapa indicada (o la primera).
 */
export async function importContactsCsv(csv: string, by: ActorRef, options: { defaultCountryCode?: string } = {}): Promise<ImportResult> {
  const parsed = Papa.parse<Record<string, string>>(csv.replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy" });
  const headers = parsed.meta.fields ?? [];
  const column = (key: keyof typeof COLUMN_ALIASES) => headers.find((h) => COLUMN_ALIASES[key].includes(normalize(h)));
  const cols = {
    name: column("name"),
    phone: column("phone"),
    email: column("email"),
    tags: column("tags"),
    stage: column("stage"),
    funnel: column("funnel"),
    assignee: column("assignee"),
  };
  if (!cols.phone && !cols.email) throw new DomainError("El archivo necesita una columna de teléfono o de correo.");
  if (parsed.data.length > MAX_ROWS) throw new DomainError(`El archivo tiene más de ${MAX_ROWS.toLocaleString("es-CL")} filas: divídelo en partes.`);

  const [stages, fields, users] = await Promise.all([
    stageOptions(),
    db.customField.findMany(),
    db.user.findMany({ where: { active: true } }),
  ]);
  if (!stages.length) throw new DomainError("No hay etapas configuradas en el funnel.");
  // Sin etapa en el archivo, el contacto entra como si escribiera por WhatsApp.
  const entry = await entryStage(db, "WHATSAPP");
  const known = new Set(Object.values(cols).filter(Boolean));
  const fieldCols = headers.flatMap((h) => {
    const f = known.has(h) ? undefined : findField(fields, h);
    return f ? [{ header: h, field: f }] : [];
  });

  const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };
  const fail = (line: number, msg: string) => {
    if (result.errors.length < MAX_ERRORS) result.errors.push(`Fila ${line}: ${msg}`);
  };

  for (const [i, row] of parsed.data.entries()) {
    const line = i + 2;
    const get = (h?: string) => (h ? String(row[h] ?? "").trim() : "");
    const rawPhone = get(cols.phone);
    const phone = rawPhone ? normalizePhone(rawPhone, options.defaultCountryCode) : null;
    const email = get(cols.email).toLowerCase() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      fail(line, `correo inválido (${email}).`);
      result.skipped++;
      continue;
    }
    if (!phone && !email) {
      fail(line, rawPhone ? `teléfono inválido (${rawPhone}).` : "sin teléfono ni correo.");
      result.skipped++;
      continue;
    }
    const stageName = get(cols.stage);
    const funnelName = normalize(get(cols.funnel));
    const inFunnel = funnelName ? stages.filter((s) => normalize(s.funnelName) === funnelName) : stages;
    if (funnelName && !inFunnel.length) fail(line, `no existe el embudo "${get(cols.funnel)}".`);
    const stage = stageName
      ? inFunnel.find((s) => normalize(s.name) === normalize(stageName))
      : funnelName
        ? inFunnel[0]
        : entry;
    if (!stage && (stageName || inFunnel.length)) fail(line, `no existe la etapa "${stageName}"; quedó en ${entry.name}.`);
    const assigneeRaw = normalize(get(cols.assignee));
    const assignee = assigneeRaw ? users.find((u) => normalize(u.email) === assigneeRaw || normalize(u.name) === assigneeRaw) : undefined;
    if (assigneeRaw && !assignee) fail(line, `no hay un usuario activo "${get(cols.assignee)}"; quedó sin asignar.`);

    try {
      const outcome = await db.$transaction(async (tx) => {
        const existing = await findExisting(tx, phone, email);
        const contact = existing
          ? await tx.contact.update({
              where: { id: existing.id },
              data: {
                ...(!existing.phone && phone ? { phone: `+${phone}` } : {}),
                ...(!existing.email && email ? { email } : {}),
              },
            })
          : await tx.contact.create({
              data: {
                name: get(cols.name) || (phone ? `+${phone}` : email!),
                phone: phone ? `+${phone}` : null,
                email,
                // Con teléfono queda como contacto de WhatsApp: si escribe, entra a este mismo contacto.
                channel: "WHATSAPP",
                externalId: phone,
              },
            });
        for (const t of parseTags(get(cols.tags))) await addTagToContact(tx, contact.id, t, by);
        for (const { header, field } of fieldCols) {
          const raw = get(header);
          if (!raw) continue;
          const parsedValue = parseFieldValue(field, raw);
          if ("error" in parsedValue) {
            fail(line, parsedValue.error);
            continue;
          }
          await tx.contactFieldValue.upsert({
            where: { contactId_fieldId: { contactId: contact.id, fieldId: field.id } },
            create: { contactId: contact.id, fieldId: field.id, value: parsedValue.value, updatedBy: by.actor },
            update: { value: parsedValue.value, updatedBy: by.actor },
          });
        }
        const open = await tx.lead.findFirst({ where: { contactId: contact.id, status: "OPEN" } });
        if (!open && !contact.blockedAt) {
          const target = stage ?? entry;
          const lead = await tx.lead.create({
            data: { contactId: contact.id, stageId: target.id, assigneeId: assignee?.id ?? null, ...(target.requiresHuman ? { aiEnabled: false } : {}) },
          });
          await tx.leadEvent.create({
            data: { leadId: lead.id, type: "CREATED", actor: by.actor, userId: by.userId ?? null, reason: "Importado desde CSV", data: { stage: target.name } },
          });
        }
        return existing ? "updated" : "created";
      });
      result[outcome]++;
    } catch (err) {
      console.error(`[importar] fila ${line}:`, err);
      fail(line, "no se pudo guardar.");
      result.skipped++;
    }
  }
  return result;
}

async function findExisting(tx: Tx, phone: string | null, email: string | null): Promise<Contact | null> {
  if (phone) {
    const byWhatsApp = await tx.contact.findUnique({ where: { channel_externalId: { channel: "WHATSAPP", externalId: phone } } });
    if (byWhatsApp) return byWhatsApp;
    const byPhone = await tx.contact.findFirst({ where: { phone: `+${phone}`, channel: { not: "SIMULATOR" } }, orderBy: { createdAt: "asc" } });
    if (byPhone) return byPhone;
  }
  if (email) {
    return tx.contact.findFirst({
      where: { email: { equals: email, mode: "insensitive" }, channel: { not: "SIMULATOR" } },
      orderBy: { createdAt: "asc" },
    });
  }
  return null;
}

/** Igual que en la ficha: una sola etiqueta por categoría; la importada reemplaza a la anterior. */
async function addTagToContact(tx: Tx, contactId: string, t: { category: string; name: string }, by: ActorRef) {
  const tag = await tx.tag.upsert({
    where: { category_name: { category: t.category, name: t.name } },
    create: { category: t.category, name: t.name },
    update: {},
  });
  await tx.contactTag.deleteMany({ where: { contactId, tag: { category: t.category }, tagId: { not: tag.id } } });
  await tx.contactTag.upsert({
    where: { contactId_tagId: { contactId, tagId: tag.id } },
    create: { contactId, tagId: tag.id, addedBy: by.actor },
    update: {},
  });
}

// --- Duplicados --------------------------------------------------------------------------

export type DuplicateContact = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  channel: Channel;
  createdAt: Date;
  leads: number;
  /** Tiene identidad en un canal (recibe mensajes por él). */
  linked: boolean;
};

/** Grupos de contactos con el mismo teléfono o el mismo correo (el primero es el que se conserva). */
export async function findDuplicateGroups(): Promise<DuplicateContact[][]> {
  const contacts = await db.contact.findMany({
    where: { channel: { not: "SIMULATOR" } },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { leads: true } } },
  });
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const p = parent.get(id) ?? id;
    if (p === id) return id;
    const root = find(p);
    parent.set(id, root);
    return root;
  };
  const firstByKey = new Map<string, string>();
  for (const c of contacts) {
    const keys = [
      c.phone && normalizePhone(c.phone) ? `p:${normalizePhone(c.phone)}` : null,
      c.channel === "WHATSAPP" && c.externalId ? `p:${c.externalId}` : null,
      c.email ? `e:${c.email.trim().toLowerCase()}` : null,
    ].filter((k): k is string => Boolean(k));
    for (const k of keys) {
      const other = firstByKey.get(k);
      if (other) parent.set(find(c.id), find(other));
      else firstByKey.set(k, c.id);
    }
  }
  const groups = new Map<string, DuplicateContact[]>();
  for (const c of contacts) {
    const root = find(c.id);
    const list = groups.get(root) ?? [];
    list.push({
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      channel: c.channel,
      createdAt: c.createdAt,
      leads: c._count.leads,
      linked: Boolean(c.externalId),
    });
    groups.set(root, list);
  }
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => [...g].sort((a, b) => Number(b.linked) - Number(a.linked) || a.createdAt.getTime() - b.createdAt.getTime()));
}

/**
 * Fusiona contactos duplicados en `keepId`: le pasa los leads, las etiquetas (sin pisar las
 * categorías que ya tiene), los campos que le faltan, el teléfono y el correo si no los tiene, y
 * borra los demás. Si el que se conserva no recibe mensajes por ningún canal, toma la identidad
 * del que sí; dos contactos con canal propio (ej. WhatsApp e Instagram) no se pueden fusionar,
 * porque el contacto guarda un solo canal.
 */
export async function mergeContacts(keepId: string, otherIds: string[], by: ActorRef) {
  const ids = [...new Set(otherIds)].filter((id) => id !== keepId);
  if (!ids.length) return;
  await db.$transaction(async (tx) => {
    const keep = await tx.contact.findUniqueOrThrow({ where: { id: keepId }, include: { tags: { include: { tag: true } }, fields: true } });
    const others = await tx.contact.findMany({ where: { id: { in: ids } }, include: { tags: { include: { tag: true } }, fields: true } });
    if (others.length !== ids.length) throw new DomainError("Uno de los contactos ya no existe.");
    if ([keep, ...others].some((c) => c.channel === "SIMULATOR")) throw new DomainError("Los contactos del simulador no se fusionan.");
    const linked = [keep, ...others].filter((c) => c.externalId);
    if (linked.length > 1) {
      throw new DomainError(
        `No se pueden fusionar: ${linked.map((c) => `${c.name} (${CHANNEL_LABEL[c.channel]})`).join(" y ")} reciben mensajes por canales distintos.`,
      );
    }
    const identity = linked[0] && linked[0].id !== keep.id ? linked[0] : null;

    const categories = new Set(keep.tags.map((t) => t.tag.category));
    const fieldIds = new Set(keep.fields.map((f) => f.fieldId));
    let phone = keep.phone;
    let email = keep.email;
    for (const o of others) {
      await tx.lead.updateMany({ where: { contactId: o.id }, data: { contactId: keep.id } });
      for (const t of o.tags) {
        if (categories.has(t.tag.category)) continue;
        categories.add(t.tag.category);
        await tx.contactTag.create({ data: { contactId: keep.id, tagId: t.tagId, addedBy: t.addedBy } });
      }
      for (const f of o.fields) {
        if (fieldIds.has(f.fieldId)) continue;
        fieldIds.add(f.fieldId);
        await tx.contactFieldValue.create({ data: { contactId: keep.id, fieldId: f.fieldId, value: f.value, updatedBy: f.updatedBy } });
      }
      phone ??= o.phone;
      email ??= o.email;
    }
    // La identidad de canal es única: primero se borra el duplicado y después pasa al que queda.
    await tx.contact.deleteMany({ where: { id: { in: ids } } });
    await tx.contact.update({
      where: { id: keep.id },
      data: { phone, email, ...(identity ? { channel: identity.channel, externalId: identity.externalId } : {}) },
    });
    const lead = await tx.lead.findFirst({ where: { contactId: keep.id }, orderBy: { createdAt: "desc" } });
    if (lead) {
      await tx.leadEvent.create({
        data: {
          leadId: lead.id,
          type: "CONTACT_MERGED",
          actor: by.actor,
          userId: by.userId ?? null,
          data: { merged: others.map((o) => o.name) },
        },
      });
    }
  });
}
