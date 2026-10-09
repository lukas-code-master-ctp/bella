"use server";

import { revalidatePath } from "next/cache";
import type { FieldType } from "@prisma/client";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { FIELD_TYPE_LABEL } from "@/lib/labels";

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

/** Lee el formulario de un campo; devuelve un mensaje si algo no cuadra. */
function readField(form: FormData) {
  const name = str(form, "name");
  const type = str(form, "type") as FieldType;
  const options = [...new Set(str(form, "options").split(",").map((o) => o.trim()).filter(Boolean))];
  if (!name) return "Escribe el nombre del campo.";
  if (!(type in FIELD_TYPE_LABEL)) return "Tipo de campo inválido.";
  if (type === "OPTIONS" && options.length < 2) return "Un campo de opciones necesita al menos dos opciones, separadas por coma.";
  return { name, type, options: type === "OPTIONS" ? options : [], description: str(form, "description") };
}

async function nameTaken(name: string, exceptId?: string) {
  const other = await db.customField.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  return !!other && other.id !== exceptId;
}

export async function createFieldAction(_prev: string | null, form: FormData): Promise<string | null> {
  await requireAdmin();
  const data = readField(form);
  if (typeof data === "string") return data;
  if (await nameTaken(data.name)) return `Ya existe el campo "${data.name}".`;
  const last = await db.customField.findFirst({ orderBy: { position: "desc" } });
  await db.customField.create({ data: { ...data, position: (last?.position ?? -1) + 1 } });
  revalidatePath("/settings/fields");
  return null;
}

export async function updateFieldAction(id: string, _prev: string | null, form: FormData): Promise<string | null> {
  await requireAdmin();
  const data = readField(form);
  if (typeof data === "string") return data;
  if (await nameTaken(data.name, id)) return `Ya existe el campo "${data.name}".`;
  await db.customField.update({ where: { id }, data });
  revalidatePath("/settings/fields");
  return "Guardado.";
}

export async function moveFieldAction(id: string, direction: -1 | 1) {
  await requireAdmin();
  const fields = await db.customField.findMany({ orderBy: { position: "asc" } });
  const index = fields.findIndex((f) => f.id === id);
  const other = fields[index + direction];
  if (!other) return;
  await db.$transaction([
    db.customField.update({ where: { id }, data: { position: other.position } }),
    db.customField.update({ where: { id: other.id }, data: { position: fields[index].position } }),
  ]);
  revalidatePath("/settings/fields");
}

export async function deleteFieldAction(id: string) {
  await requireAdmin();
  await db.customField.delete({ where: { id } });
  revalidatePath("/settings/fields");
}
