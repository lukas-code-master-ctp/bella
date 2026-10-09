import type { CustomField, Prisma } from "@prisma/client";
import { db } from "../db";
import { FIELD_TYPE_LABEL } from "../labels";
import { normalize } from "../text";
import { DomainError, type ActorRef } from "./leads";

type Tx = Prisma.TransactionClient;
type FieldDef = Pick<CustomField, "name" | "type" | "options">;

const MAX_TEXT = 500;

/** Valida el RUT chileno (módulo 11) y lo devuelve como 12.345.678-5, o null si no es válido. */
export function formatRut(raw: string): string | null {
  const clean = raw.replace(/[^0-9kK]/g, "").toUpperCase();
  if (clean.length < 2 || clean.length > 9) return null;
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1);
  if (!/^\d+$/.test(body)) return null;
  let sum = 0;
  let factor = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const rest = 11 - (sum % 11);
  const expected = rest === 11 ? "0" : rest === 10 ? "K" : String(rest);
  if (dv !== expected) return null;
  return `${Number(body).toLocaleString("es-CL")}-${dv}`;
}

/**
 * Lee un número escrito como lo escribe un cliente chileno: "50.000.000", "$ 45 millones",
 * "1,5 MM" o "80 mil". Los puntos separan miles y la coma es decimal.
 */
export function parseAmount(raw: string): number | null {
  const text = raw.toLowerCase().replace(/\s+/g, " ").trim();
  const match = text.match(/\d[\d.]*(,\d+)?/);
  if (!match) return null;
  let n = Number(match[0].replace(/\./g, "").replace(",", "."));
  const rest = text.slice(match.index! + match[0].length);
  if (/^ ?(millones|millón|millon|mill|mm)/.test(rest)) n *= 1_000_000;
  else if (/^ ?(mil|k\b)/.test(rest)) n *= 1_000;
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** Valida y normaliza el valor según el tipo del campo. */
export function parseFieldValue(field: FieldDef, raw: string): { value: string } | { error: string } {
  const text = raw.trim();
  switch (field.type) {
    case "NUMBER": {
      const n = parseAmount(text);
      return n == null ? { error: `"${field.name}" debe ser un número.` } : { value: String(n) };
    }
    case "RUT": {
      const rut = formatRut(text);
      return rut ? { value: rut } : { error: `RUT inválido (${text}): revisa el dígito verificador.` };
    }
    case "OPTIONS": {
      const option = field.options.find((o) => normalize(o) === normalize(text));
      return option
        ? { value: option }
        : { error: `"${text}" no es una opción de "${field.name}". Opciones: ${field.options.join(", ")}` };
    }
    default:
      return { value: text.slice(0, MAX_TEXT) };
  }
}

/** Valor listo para mostrar (los números con separador de miles). */
export function displayFieldValue(field: Pick<CustomField, "type">, value: string): string {
  return field.type === "NUMBER" && /^\d+$/.test(value) ? Number(value).toLocaleString("es-CL") : value;
}

/**
 * Guarda (o borra, si `raw` está vacío) el valor de un campo del contacto del lead y lo deja en
 * el historial. Devuelve el valor guardado, o undefined si no cambió nada.
 */
export async function setFieldValueTx(
  tx: Tx,
  leadId: string,
  field: CustomField,
  raw: string,
  by: ActorRef,
  reason?: string,
): Promise<string | null | undefined> {
  const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
  const key = { contactId_fieldId: { contactId: lead.contactId, fieldId: field.id } };
  const current = await tx.contactFieldValue.findUnique({ where: key });

  let value: string | null = null;
  if (raw.trim()) {
    const parsed = parseFieldValue(field, raw);
    if ("error" in parsed) throw new DomainError(parsed.error);
    value = parsed.value;
  }
  if ((current?.value ?? null) === value) return undefined;

  if (value == null) await tx.contactFieldValue.delete({ where: key });
  else {
    await tx.contactFieldValue.upsert({
      where: key,
      create: { contactId: lead.contactId, fieldId: field.id, value, updatedBy: by.actor },
      update: { value, updatedBy: by.actor },
    });
  }
  await tx.leadEvent.create({
    data: {
      leadId,
      type: "FIELD_UPDATED",
      actor: by.actor,
      userId: by.userId,
      reason,
      data: { field: field.name, value: value == null ? null : displayFieldValue(field, value) },
    },
  });
  return value;
}

/**
 * Formulario de la ficha del lead: valida todos los campos antes de guardar, para no dejar
 * cambios a medias. `values` va por id de campo; un valor vacío borra el dato.
 */
export async function setContactFields(leadId: string, values: Record<string, string>, by: ActorRef) {
  const fields = await db.customField.findMany({
    where: { id: { in: Object.keys(values) } },
    orderBy: { position: "asc" },
  });
  const errors = fields.flatMap((f) => {
    const raw = values[f.id].trim();
    const parsed = raw ? parseFieldValue(f, raw) : null;
    return parsed && "error" in parsed ? [parsed.error] : [];
  });
  if (errors.length) throw new DomainError(errors.join(" "));
  await db.$transaction(async (tx) => {
    for (const f of fields) await setFieldValueTx(tx, leadId, f, values[f.id], by);
  });
}

/** Líneas de los campos del cliente para el <crm_state> de la IA. */
export async function fieldsForCrmState(contactId: string): Promise<string[]> {
  const fields = await db.customField.findMany({
    orderBy: { position: "asc" },
    include: { values: { where: { contactId } } },
  });
  if (!fields.length) return [];
  return [
    "Campos del cliente (guárdalos con set_contact_field):",
    ...fields.map((f) => {
      const value = f.values[0] ? displayFieldValue(f, f.values[0].value) : "sin dato";
      const kind =
        f.type === "OPTIONS" ? `opciones: ${f.options.join(" | ")}` : FIELD_TYPE_LABEL[f.type].toLowerCase();
      return `- ${f.name} = ${value} (${kind}${f.description ? `; ${f.description}` : ""})`;
    }),
  ];
}

export function findField(fields: CustomField[], name: string) {
  const target = normalize(name);
  return fields.find((f) => normalize(f.name) === target);
}
