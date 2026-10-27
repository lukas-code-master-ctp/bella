import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createLead, handoffToHumanTx, moveStage, setAiEnabled, setAssignee } from "@/lib/domain/leads";
import {
  latestNotificationPerLead,
  markLeadNotificationsRead,
  markLessonNotificationsRead,
  notifyContactMessage,
  notifyLessonPending,
} from "@/lib/domain/notifications";
import { notificationUrl } from "@/lib/domain/notification-links";
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

  it("la página muestra solo el último aviso de cada lead", async () => {
    await seedFunnel();
    const ana = await executive("Ana");
    const maria = await createLead({ name: "María", channel: "SIMULATOR" });
    const pedro = await createLead({ name: "Pedro", channel: "SIMULATOR" });
    const at = (min: number) => new Date(Date.now() - min * 60_000);
    await db.notification.createMany({
      data: [
        { userId: ana.id, leadId: maria.id, type: "ASSIGNED", title: "María", body: "viejo", readAt: at(50), createdAt: at(60) },
        { userId: ana.id, leadId: pedro.id, type: "ASSIGNED", title: "Pedro", body: "pedro", createdAt: at(30) },
        { userId: ana.id, leadId: maria.id, type: "CONTACT_MESSAGE", title: "María", body: "nuevo", createdAt: at(10) },
      ],
    });
    expect((await latestNotificationPerLead(ana.id)).map((n) => n.body)).toEqual(["nuevo", "pedro"]);
  });

  it("una regla propuesta por un ejecutivo avisa a los admins y lleva a Aprendizajes", async () => {
    await seedFunnel();
    const boss = await admin();
    const ana = await executive("Ana");
    const lead = await createLead({ name: "María", channel: "SIMULATOR" });
    await db.notification.create({ data: { userId: boss.id, leadId: lead.id, type: "HUMAN_STAGE", title: "María", body: "x" } });
    const rule = (r: string) => db.aiLesson.create({ data: { rule: r, leadId: lead.id, createdBy: "Ana" } });

    await notifyLessonPending(await rule("Habla del proyecto"), ana.id);
    await notifyLessonPending(await rule("No ofrezcas ejecutivo"), ana.id);

    const [lessonNotice] = await db.notification.findMany({ where: { userId: boss.id, type: "LESSON_PENDING" } });
    expect(lessonNotice).toMatchObject({ title: "2 reglas para la IA por revisar", body: "Ana propuso: «No ofrezcas ejecutivo»", readAt: null });
    expect(notificationUrl(lessonNotice)).toBe("/settings/lessons");
    expect(await db.notification.count({ where: { userId: ana.id, type: "LESSON_PENDING" } })).toBe(0);
    // Se ve aparte del aviso del lead, y abrir el lead no lo marca como leído.
    expect((await latestNotificationPerLead(boss.id)).map((n) => n.type).sort()).toEqual(["HUMAN_STAGE", "LESSON_PENDING"]);
    await markLeadNotificationsRead(boss.id, lead.id);
    expect(await db.notification.count({ where: { userId: boss.id, readAt: null } })).toBe(1);
    await markLessonNotificationsRead(boss.id);
    expect(await db.notification.count({ where: { userId: boss.id, readAt: null } })).toBe(0);
  });
});
