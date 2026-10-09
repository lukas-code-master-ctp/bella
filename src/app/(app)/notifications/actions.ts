"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { markAllNotificationsRead, unreadNotificationCount } from "@/lib/domain/notifications";

/** Contador de la campana (la barra lateral lo consulta cada cierto tiempo). */
export async function unreadCountAction() {
  const user = await requireUser();
  return unreadNotificationCount(user.id);
}

export async function markAllReadAction() {
  const user = await requireUser();
  await markAllNotificationsRead(user.id);
  revalidatePath("/notifications");
}

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

/** Guarda la suscripción Web Push de este navegador para el usuario actual. */
export async function savePushSubscriptionAction(raw: unknown) {
  const user = await requireUser();
  const sub = subscriptionSchema.parse(raw);
  await db.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { userId: user.id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    update: { userId: user.id, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
  });
}

export async function deletePushSubscriptionAction(endpoint: string) {
  const user = await requireUser();
  await db.pushSubscription.deleteMany({ where: { endpoint, userId: user.id } });
}
