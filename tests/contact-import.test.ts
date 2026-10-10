import { describe, expect, it } from "vitest";
import Papa from "papaparse";
import { db } from "@/lib/db";
import {
  exportContactsCsv,
  findDuplicateGroups,
  importContactsCsv,
  mergeContacts,
  normalizePhone,
  parseTags,
} from "@/lib/domain/contact-import";
import { receiveWhatsApp } from "@/lib/domain/channels";
import { executive, seedFunnel } from "./factories";

const admin = { actor: "USER" as const };

describe("importar contactos", () => {
  it("normaliza teléfonos y etiquetas", () => {
    expect(normalizePhone("+56 9 1111 2222")).toBe("56911112222");
    expect(normalizePhone("9 1111 2222", "56")).toBe("56911112222");
    expect(normalizePhone("0056911112222")).toBe("56911112222");
    expect(normalizePhone("123")).toBeNull();
    expect(parseTags("Interés: alto; vip")).toEqual([
      { category: "Interés", name: "alto" },
      { category: "General", name: "vip" },
    ]);
  });

  it("crea contactos con lead, etiquetas, campos y ejecutivo, y no duplica al reimportar", async () => {
    const stages = await seedFunnel();
    const ana = await executive("Ana");
    await db.customField.create({ data: { name: "Presupuesto", type: "NUMBER", position: 0 } });
    const csv = [
      "Nombre,Teléfono,Correo,Etiquetas,Etapa,Ejecutivo,Presupuesto",
      "Pedro,+56 9 1111 2222,pedro@x.cl,Interés: alto,Calificado,ana@test.cl,50 millones",
      "Sin datos,,,,,,",
      "Laura,9 3333 4444,,,Etapa rara,,",
    ].join("\n");
    const r = await importContactsCsv(csv, admin, { defaultCountryCode: "56" });
    expect(r).toMatchObject({ created: 2, updated: 0, skipped: 1 });
    expect(r.errors.join(" ")).toMatch(/Etapa rara/);

    const pedro = await db.contact.findFirstOrThrow({
      where: { name: "Pedro" },
      include: { leads: true, tags: { include: { tag: true } }, fields: true },
    });
    expect(pedro).toMatchObject({ channel: "WHATSAPP", externalId: "56911112222", phone: "+56911112222", email: "pedro@x.cl" });
    expect(pedro.leads).toHaveLength(1);
    expect(pedro.leads[0]).toMatchObject({ stageId: stages[1].id, assigneeId: ana.id });
    expect(pedro.tags.map((t) => `${t.tag.category}: ${t.tag.name}`)).toEqual(["Interés: alto"]);
    expect(pedro.fields[0].value).toBe("50000000");

    // Reimportar actualiza: la etiqueta de la misma categoría se reemplaza y no se crea otro lead.
    const again = await importContactsCsv("telefono,etiquetas\n+56911112222,Interés: medio", admin);
    expect(again).toMatchObject({ created: 0, updated: 1 });
    const tags = await db.contactTag.findMany({ where: { contactId: pedro.id }, include: { tag: true } });
    expect(tags.map((t) => t.tag.name)).toEqual(["medio"]);
    expect(await db.lead.count({ where: { contactId: pedro.id } })).toBe(1);

    // Si después escribe por WhatsApp, entra al mismo contacto y lead.
    await receiveWhatsApp({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: { messages: [{ from: "56911112222", id: "wamid.1", type: "text", text: { body: "hola" } }] } }] }],
    });
    expect(await db.message.findFirst({ where: { externalId: "wamid.1" } })).toMatchObject({ leadId: pedro.leads[0].id });
    expect(await db.contact.count()).toBe(2);
  });

  it("rechaza un archivo sin teléfono ni correo", async () => {
    await seedFunnel();
    await expect(importContactsCsv("nombre\nPedro", admin)).rejects.toThrow(/teléfono o de correo/);
  });

  it("exporta en un formato que se puede volver a importar", async () => {
    await seedFunnel();
    await importContactsCsv("Nombre,Teléfono,Etiquetas\nPedro,+56911112222,Interés: alto", admin);
    const csv = await exportContactsCsv();
    const rows = Papa.parse<Record<string, string>>(csv.replace(/^﻿/, ""), { header: true }).data;
    expect(rows[0]).toMatchObject({ Nombre: "Pedro", Teléfono: "+56911112222", Etiquetas: "Interés: alto", Etapa: "Nuevo", Estado: "Abierto" });
    expect(await importContactsCsv(csv, admin)).toMatchObject({ created: 0, updated: 1 });
  });
});

describe("fusionar duplicados", () => {
  it("agrupa por teléfono o correo y fusiona leads, etiquetas y campos", async () => {
    const stages = await seedFunnel();
    const wa = await db.contact.create({ data: { name: "Pedro WA", channel: "WHATSAPP", externalId: "56911112222", phone: "+56911112222" } });
    const ig = await db.contact.create({ data: { name: "Pedro IG", channel: "INSTAGRAM", externalId: "ig-1", email: "p@x.cl" } });
    const imported = await db.contact.create({ data: { name: "Pedro", channel: "WHATSAPP", email: "P@x.cl", phone: "+56 9 1111 2222" } });
    const tag = await db.tag.create({ data: { category: "Interés", name: "alto" } });
    await db.contactTag.create({ data: { contactId: imported.id, tagId: tag.id, addedBy: "USER" } });
    await db.lead.create({ data: { contactId: imported.id, stageId: stages[0].id } });

    const groups = await findDuplicateGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].map((c) => c.id).sort()).toEqual([wa.id, ig.id, imported.id].sort());

    // Dos contactos con canal propio no se fusionan.
    await expect(mergeContacts(wa.id, [ig.id, imported.id], admin)).rejects.toThrow(/canales distintos/);

    await mergeContacts(imported.id, [wa.id], admin);
    const kept = await db.contact.findUniqueOrThrow({ where: { id: imported.id }, include: { tags: true, leads: true } });
    // Toma la identidad de WhatsApp del duplicado para seguir recibiendo sus mensajes.
    expect(kept).toMatchObject({ channel: "WHATSAPP", externalId: "56911112222", email: "P@x.cl" });
    expect(kept.tags).toHaveLength(1);
    expect(kept.leads).toHaveLength(1);
    expect(await db.contact.findUnique({ where: { id: wa.id } })).toBeNull();
  });
});
