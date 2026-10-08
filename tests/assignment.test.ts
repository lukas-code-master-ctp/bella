import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createLead, addTag, moveStage } from "@/lib/domain/leads";
import { pickLeastLoaded, pickRoundRobin } from "@/lib/domain/assignment";
import { executive, seedFunnel } from "./factories";

describe("selección de ejecutivo", () => {
  const users = [{ id: "b" }, { id: "a" }, { id: "c" }] as never[];

  it("round robin rota en orden estable y vuelve al inicio", () => {
    expect(pickRoundRobin(users, null)?.id).toBe("a");
    expect(pickRoundRobin(users, "a")?.id).toBe("b");
    expect(pickRoundRobin(users, "c")?.id).toBe("a");
  });

  it("menor carga elige al ejecutivo con menos leads abiertos", () => {
    expect(pickLeastLoaded(users, new Map([["a", 3], ["b", 1], ["c", 1]]))?.id).toBe("b");
  });
});

describe("asignación automática", () => {
  it("al entrar a la etapa de atención humana asigna al ejecutivo con menos carga y pausa la IA", async () => {
    const [, , , human] = await seedFunnel();
    const ana = await executive("Ana");
    const beto = await executive("Beto");
    const busy = await createLead({ name: "Ocupado", channel: "SIMULATOR" });
    await db.lead.update({ where: { id: busy.id }, data: { assigneeId: ana.id } });

    const lead = await createLead({ name: "Cliente", channel: "SIMULATOR" });
    await moveStage(lead.id, human.id, { actor: "AI" }, "pidió hablar con alguien");

    const updated = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(updated.assigneeId).toBe(beto.id);
    expect(updated.aiEnabled).toBe(false);
  });

  it("aplica una regla por etiqueta en round robin entre los ejecutivos de la regla", async () => {
    await seedFunnel();
    const ana = await executive("Ana");
    const beto = await executive("Beto");
    await executive("Carla");
    const tag = await db.tag.create({ data: { category: "Producto", name: "Motos" } });
    await db.assignmentRule.create({
      data: {
        name: "Motos",
        trigger: "TAG_ADDED",
        tagId: tag.id,
        executives: { connect: [{ id: ana.id }, { id: beto.id }] },
      },
    });

    const assigned = [];
    for (const name of ["L1", "L2", "L3"]) {
      const lead = await createLead({ name, channel: "SIMULATOR" });
      await addTag(lead.id, tag.id, { actor: "AI" });
      assigned.push((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).assigneeId);
    }
    const sorted = [ana.id, beto.id].sort();
    expect(assigned).toEqual([sorted[0], sorted[1], sorted[0]]);
  });

  it("no reasigna un lead que ya tiene ejecutivo salvo que la regla lo pida", async () => {
    const [, calificado] = await seedFunnel();
    const ana = await executive("Ana");
    const beto = await executive("Beto");
    await db.assignmentRule.create({
      data: { name: "Calificados a Beto", trigger: "STAGE_ENTERED", stageId: calificado.id, executives: { connect: [{ id: beto.id }] } },
    });
    const lead = await createLead({ name: "Cliente", channel: "SIMULATOR" });
    await db.lead.update({ where: { id: lead.id }, data: { assigneeId: ana.id } });

    await moveStage(lead.id, calificado.id, { actor: "USER", userId: ana.id });
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).assigneeId).toBe(ana.id);
  });
});

describe("etiquetas", () => {
  it("una etiqueta nueva reemplaza a la de la misma categoría", async () => {
    await seedFunnel();
    const medio = await db.tag.create({ data: { category: "Interés", name: "Medio" } });
    const alto = await db.tag.create({ data: { category: "Interés", name: "Alto" } });
    const moto = await db.tag.create({ data: { category: "Producto", name: "Motos" } });
    const lead = await createLead({ name: "Cliente", channel: "SIMULATOR" });

    await addTag(lead.id, medio.id, { actor: "AI" });
    await addTag(lead.id, moto.id, { actor: "AI" });
    await addTag(lead.id, alto.id, { actor: "AI" });

    const tags = await db.contactTag.findMany({ where: { contactId: lead.contactId }, include: { tag: true } });
    expect(tags.map((t) => t.tag.name).sort()).toEqual(["Alto", "Motos"]);
  });
});
