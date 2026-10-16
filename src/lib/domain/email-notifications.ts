import { db } from "../db";
import { APP_URL, emailConfigured, emailFrom, escapeHtml, resendSender, type EmailSender } from "../email";

/**
 * Avisos por correo. Cada persona elige en Avisos cuáles quiere recibir también por correo; todos
 * vienen apagados. Los avisos de un lead (los de la campana) salen junto con el push, y los demás
 * (campañas en alerta) con `emailUsers`. Se manda a lo más un correo por aviso sin leer: si el
 * aviso se actualiza (el cliente vuelve a escribir) no se repite hasta que la persona lo lea.
 */
export const EMAIL_NOTIFICATION_TYPES = [
  { type: "ASSIGNED", label: "Me asignan un lead", adminOnly: false },
  { type: "HUMAN_STAGE", label: "Un lead mío necesita atención humana", adminOnly: false },
  { type: "CONTACT_MESSAGE", label: "Me escribe un lead que atiendo yo", adminOnly: false },
  { type: "TASK_DUE", label: "Una tarea mía está por vencer", adminOnly: false },
  { type: "CAMPAIGN_ALERT", label: "Una campaña pierde casi todos sus leads", adminOnly: true },
] as const;

export type EmailNotificationType = (typeof EMAIL_NOTIFICATION_TYPES)[number]["type"];

/** Avisos más antiguos que esto no se mandan (ej. los que ya estaban al activar el correo). */
const MAX_AGE_MS = 60 * 60 * 1000;

export async function saveEmailNotificationPrefs(userId: string, types: string[], isAdmin: boolean) {
  const allowed = EMAIL_NOTIFICATION_TYPES.filter((t) => isAdmin || !t.adminOnly).map((t) => t.type as string);
  await db.user.update({
    where: { id: userId },
    data: { emailNotifications: [...new Set(types.filter((t) => allowed.includes(t)))] },
  });
}

/** Asunto, HTML y texto de un aviso. */
export function renderNotificationEmail({ title, body, url }: { title: string; body: string; url: string }) {
  const link = APP_URL ? `${APP_URL}${url}` : null;
  const subject = `${title}: ${body}`.slice(0, 140);
  const text = [title, body, ...(link ? ["", `Abrir en Beliapp: ${link}`] : []), "", "Elige qué avisos te llegan por correo en Beliapp → Avisos."].join("\n");
  const html = [
    `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1c1530;line-height:1.5">`,
    `<h1 style="font-size:18px;margin:0 0 6px">${escapeHtml(title)}</h1>`,
    `<p style="font-size:15px;margin:0">${escapeHtml(body)}</p>`,
    link
      ? `<p style="margin-top:20px"><a href="${escapeHtml(link)}" style="background:#2c8040;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Abrir en Beliapp</a></p>`
      : "",
    `<p style="color:#6b6380;font-size:12px;margin-top:24px">Elige qué avisos te llegan por correo en Beliapp → Avisos.</p>`,
    `</div>`,
  ].join("");
  return { subject, html, text };
}

async function ready(sender: EmailSender) {
  if (sender === resendSender && !(await emailConfigured())) return null;
  return emailFrom();
}

/**
 * Manda por correo los avisos de leads recientes, sin leer y aún no mandados, a quienes pidieron
 * ese tipo de aviso. Se llama junto con el push. Nunca lanza.
 */
export async function deliverPendingEmails({ sender = resendSender, now = new Date() }: { sender?: EmailSender; now?: Date } = {}) {
  try {
    const candidates = await db.notification.findMany({
      where: {
        emailedAt: null,
        readAt: null,
        createdAt: { gt: new Date(now.getTime() - MAX_AGE_MS) },
        user: { active: true, emailNotifications: { isEmpty: false } },
      },
      include: { user: { select: { email: true, emailNotifications: true } } },
      take: 100,
    });
    const wanted = candidates.filter((n) => n.user.emailNotifications.includes(n.type));
    if (!wanted.length) return;
    const from = await ready(sender);
    if (!from) return;

    for (const n of wanted) {
      // Se marca antes de mandar para que dos llamadas seguidas no manden el mismo correo.
      const { count } = await db.notification.updateMany({ where: { id: n.id, emailedAt: null }, data: { emailedAt: now } });
      if (!count) continue;
      try {
        await sender.send({ from, to: [n.user.email], ...renderNotificationEmail({ title: n.title, body: n.body, url: `/leads/${n.leadId}` }) });
      } catch (e) {
        console.error("No se pudo mandar el aviso por correo", e);
      }
    }
  } catch (e) {
    console.error("No se pudieron mandar los avisos por correo", e);
  }
}

/** Correo directo a unos usuarios, para avisos que no son de un lead. Solo a quienes lo pidieron. Nunca lanza. */
export async function emailUsers(
  userIds: string[],
  type: EmailNotificationType,
  content: { title: string; body: string; url: string },
  { sender = resendSender }: { sender?: EmailSender } = {},
) {
  try {
    if (!userIds.length) return;
    const users = await db.user.findMany({
      where: { id: { in: userIds }, active: true, emailNotifications: { has: type } },
      select: { email: true },
    });
    if (!users.length) return;
    const from = await ready(sender);
    if (!from) return;
    const email = renderNotificationEmail(content);
    for (const u of users) {
      await sender.send({ from, to: [u.email], ...email }).catch((e) => console.error("No se pudo mandar el aviso por correo", e));
    }
  } catch (e) {
    console.error("No se pudieron mandar los avisos por correo", e);
  }
}

/** Correo de prueba para revisar la clave y el remitente. Lanza con el motivo si no se puede. */
export async function sendTestEmail(to: string, { sender = resendSender }: { sender?: EmailSender } = {}) {
  if (sender === resendSender && !(await emailConfigured())) throw new Error("Falta la clave de Resend.");
  const from = await emailFrom();
  if (!from) throw new Error("Falta el remitente de los correos.");
  await sender.send({
    from,
    to: [to],
    ...renderNotificationEmail({ title: "Correo de prueba", body: "Si te llegó este correo, Beliapp ya puede mandar avisos por correo.", url: "/notifications" }),
  });
}
