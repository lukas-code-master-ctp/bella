import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { DEFAULT_EMAIL_FROM, emailFrom, type Email, type EmailSender } from "@/lib/email";
import { createLead } from "@/lib/domain/leads";
import { deliverPendingEmails, emailUsers, saveEmailNotificationPrefs, sendTestEmail } from "@/lib/domain/email-notifications";
import { executive, seedFunnel } from "./factories";

function fakeSender() {
  const sent: Email[] = [];
  const sender: EmailSender = {
    async send(email) {
      sent.push(email);
      return `email-${sent.length}`;
    },
  };
  return { sender, sent };
}

async function setup() {
  await seedFunnel();
  const lead = await createLead({ name: "María", channel: "SIMULATOR" });
  const ana = await executive("Ana");
  const beto = await executive("Beto");
  return { lead, ana, beto };
}

const notify = (userId: string, leadId: string, type = "ASSIGNED", body = "Te asignaron este lead") =>
  db.notification.create({ data: { userId, leadId, type, title: "María", body } });

describe("avisos por correo", () => {
  it("manda solo los tipos que la persona eligió, una vez por aviso sin leer", async () => {
    const { lead, ana, beto } = await setup();
    await saveEmailNotificationPrefs(ana.id, ["ASSIGNED", "CAMPAIGN_ALERT", "INVENTADO"], false);
    expect((await db.user.findUniqueOrThrow({ where: { id: ana.id } })).emailNotifications).toEqual(["ASSIGNED"]);

    const n = await notify(ana.id, lead.id);
    await notify(ana.id, lead.id, "TASK_DUE", "Tarea por vencer");
    await notify(beto.id, lead.id);
    const { sender, sent } = fakeSender();
    await deliverPendingEmails({ sender });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ from: DEFAULT_EMAIL_FROM, to: ["ana@test.cl"] });
    expect(sent[0].subject).toBe("María: Te asignaron este lead");
    expect(sent[0].text).toContain("Te asignaron este lead");

    // El aviso se actualiza (sigue sin leer): no se repite.
    await db.notification.update({ where: { id: n.id }, data: { body: "Otra vez", createdAt: new Date() } });
    await deliverPendingEmails({ sender });
    expect(sent).toHaveLength(1);
  });

  it("no manda avisos antiguos ni leídos", async () => {
    const { lead, ana } = await setup();
    await saveEmailNotificationPrefs(ana.id, ["ASSIGNED"], false);
    await db.notification.create({
      data: { userId: ana.id, leadId: lead.id, type: "ASSIGNED", title: "María", body: "x", createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
    });
    await db.notification.create({ data: { userId: ana.id, leadId: lead.id, type: "ASSIGNED", title: "María", body: "x", readAt: new Date() } });
    const { sender, sent } = fakeSender();
    await deliverPendingEmails({ sender });
    expect(sent).toHaveLength(0);

  });

  it("los avisos de campañas llegan solo a los admins que los pidieron", async () => {
    const { ana } = await setup();
    const admin = await db.user.create({ data: { name: "Admin", email: "admin@test.cl", passwordHash: "x", role: "ADMIN" } });
    await saveEmailNotificationPrefs(admin.id, ["CAMPAIGN_ALERT"], true);
    const { sender, sent } = fakeSender();
    await emailUsers([admin.id, ana.id], "CAMPAIGN_ALERT", { title: "Campaña", body: "Pierde leads", url: "/metrics/campaigns" }, { sender });
    expect(sent.map((e) => e.to)).toEqual([["admin@test.cl"]]);
  });

  it("todos los correos salen con el remitente de la plataforma", async () => {
    expect(emailFrom()).toBe(DEFAULT_EMAIL_FROM);
    process.env.EMAIL_FROM = "Otro <otro@beliapp.cl>";
    try {
      expect(emailFrom()).toBe("Otro <otro@beliapp.cl>");
    } finally {
      delete process.env.EMAIL_FROM;
    }
    const { sender, sent } = fakeSender();
    await sendTestEmail("eva@test.cl", { sender });
    expect(sent[0]).toMatchObject({ to: ["eva@test.cl"], from: DEFAULT_EMAIL_FROM, subject: expect.stringContaining("Correo de prueba") });
  });
});
