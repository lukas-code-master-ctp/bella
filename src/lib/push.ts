import webpush from "web-push";
import { db } from "./db";

/**
 * Web Push al navegador. Requiere VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY (genéralas con
 * `npx web-push generate-vapid-keys`). Sin ellas, los avisos quedan solo en la campana.
 */
export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

let configured = false;
function configure() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  if (!configured) {
    const subject =
      process.env.VAPID_SUBJECT ||
      (process.env.SEED_ADMIN_EMAIL ? `mailto:${process.env.SEED_ADMIN_EMAIL}` : "mailto:avisos@bella.app");
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configured = true;
  }
  return true;
}

export type PushPayload = { title: string; body: string; url: string; tag: string };

/**
 * Envía los avisos con push pendiente a los navegadores suscritos de cada usuario.
 * Se llama después de cada transacción que puede crear avisos. Nunca lanza: un push
 * fallido no debe romper la acción que lo originó.
 */
export async function deliverPendingPush() {
  try {
    const pending = await db.notification.findMany({ where: { pushedAt: null }, take: 100 });
    if (pending.length === 0) return;
    await db.notification.updateMany({
      where: { id: { in: pending.map((n) => n.id) }, pushedAt: null },
      data: { pushedAt: new Date() },
    });
    if (!configure()) return;

    const subs = await db.pushSubscription.findMany({
      where: { userId: { in: [...new Set(pending.map((n) => n.userId))] } },
    });
    await Promise.all(
      pending.flatMap((n) =>
        subs
          .filter((s) => s.userId === n.userId)
          .map((s) => {
            const payload: PushPayload = { title: n.title, body: n.body, url: `/leads/${n.leadId}`, tag: n.leadId };
            return webpush
              .sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), {
                TTL: 60 * 60,
                urgency: "high",
              })
              .catch(async (e: { statusCode?: number }) => {
                // 404/410: el navegador anuló la suscripción.
                if (e.statusCode === 404 || e.statusCode === 410) {
                  await db.pushSubscription.deleteMany({ where: { id: s.id } });
                } else {
                  console.error("Web Push falló", e);
                }
              });
          }),
      ),
    );
  } catch (e) {
    console.error("No se pudieron enviar los avisos push", e);
  }
}

/**
 * Push directo a los navegadores de unos usuarios, para avisos que no son de un lead (ej. el
 * resumen semanal). Nunca lanza.
 */
export async function pushToUsers(userIds: string[], payload: PushPayload) {
  try {
    if (!userIds.length || !configure()) return;
    const subs = await db.pushSubscription.findMany({ where: { userId: { in: userIds } } });
    await Promise.all(
      subs.map((s) =>
        webpush
          .sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 24 * 60 * 60 })
          .catch(async (e: { statusCode?: number }) => {
            if (e.statusCode === 404 || e.statusCode === 410) await db.pushSubscription.deleteMany({ where: { id: s.id } });
            else console.error("Web Push falló", e);
          }),
      ),
    );
  } catch (e) {
    console.error("No se pudo enviar el push", e);
  }
}
