import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createLead, handoffToHumanTx, moveStage, setAiEnabled, setAssignee } from "@/lib/domain/leads";
import { markLeadNotificationsRead, notifyContactMessage } from "@/lib/domain/notifications";
import { executive, seedFunnel } from "./factories";

const notificationsOf = (userId: string) => db.notification.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });

async function admin(name = "Admin") {
  return db.user.create({ data: { name, email: `${name.toLowerCase()}@test.cl`, passwordHash: "x", role: "ADMIN" } });
}

describe("avisos al ejecutivo", () => {
  it("al entrar a atención humana avisa al ejecutivo que queda asignado (un solo aviso)", async () => {
    const stages = await seedFunnel();
    const ana = await executive("Ana");
    const lead = await createLead({ name: "María", channel: "SIMULATOR" });

    await moveStage(lead.id, stages[3].id, { actor: "AI" }, "Quiere visitar la parcela");

    const list = await notificationsOf(ana.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ type: "HUMAN_STAGE", title: "María", readAt: null });
    expect(list[0].body).toContain("Quiere visitar la parcela");
    // Sin claves VAPID el push se descarta, pero queda marcado como procesado.
    expect(list[0].pushedAt).not.toBeNull();
  });

  it("la derivación de la IA avisa con el motivo", async () => {
    await seedFunnel();
    const ana = await executive("Ana");
    const lead = await createLead({ name: "María", channel: "SIMULATOR" });
    await db.$transaction((tx) => handoffToHumanTx(tx, lead.id, "Pide hablar con una persona"));

    const [n] = await notificationsOf(ana.id);
    expect(n.type).toBe("HUMAN_STAGE");
    expect(n.body).toContain("Pide hablar con una persona");
  });

  it("asignar a mano avisa al ejecutivo, pero no a quien se asigna a sí mismo", async () => {
    await seedFunnel();
    const ana = await executive("Ana");
    const boss = await admin();
    const lead = await createLead({ name: "María", channel: "SIMULATOR" });

    await setAssignee(lead.id, ana.id, { actor: "USER", userId: boss.id });
    expect(await notificationsOf(ana.id)).toMatchObject([{ type: "ASSIGNED" }]);

    await setAssignee(lead.id, boss.id, { actor: "USER", userId: boss.id });
    expect(await notificationsOf(boss.id)).toHaveLength(0);
  });

  it("un mensaje del cliente avisa solo si lo atiende un humano", async () => {
    await seedFunnel();
    const ana = await executive("Ana");
    const lead = await createLead({ name: "María", channel: "SIMULATOR" });
    await setAssignee(lead.id, ana.id, { actor: "SYSTEM" });
    await markLeadNotificationsRead(ana.id, lead.id);

    // La IA atiende: no avisa.
    await notifyContactMessage(lead.id, "Hola");
    expect(await db.notification.count({ where: { userId: ana.id, readAt: null } })).toBe(0);

    // IA pausada: avisa con el texto.
    await setAiEnabled(lead.id, false, { actor: "USER", userId: ana.id });
    await notifyContactMessage(lead.id, "¿Siguen disponibles las parcelas?");
    await notifyContactMessage(lead.id, "Quiero ir el sábado");
    const unread = await db.notification.findMany({ where: { userId: ana.id, readAt: null } });
    // Los mensajes seguidos se juntan en un solo aviso con el último texto.
    expect(unread).toHaveLength(1);
    expect(unread[0]).toMatchObject({ type: "CONTACT_MESSAGE", body: "Escribió: «Quiero ir el sábado»" });
  });

  it("sin ejecutivo asignado avisa a los administradores", async () => {
    const stages = await seedFunnel();
    const boss = await admin();
    const lead = await createLead({ name: "María", channel: "SIMULATOR" });
    await moveStage(lead.id, stages[3].id, { actor: "AI" });
    expect(await notificationsOf(boss.id)).toMatchObject([{ type: "HUMAN_STAGE" }]);
  });

  it("abrir el lead marca sus avisos como leídos", async () => {
    const stages = await seedFunnel();
    const ana = await executive("Ana");
    const lead = await createLead({ name: "María", channel: "SIMULATOR" });
    await moveStage(lead.id, stages[3].id, { actor: "AI" });
    await markLeadNotificationsRead(ana.id, lead.id);
    expect(await db.notification.count({ where: { userId: ana.id, readAt: null } })).toBe(0);
  });
});
