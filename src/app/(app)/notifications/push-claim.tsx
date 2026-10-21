"use client";

import { useEffect } from "react";
import { savePushSubscriptionAction } from "./actions";

/**
 * Si este navegador ya tiene los avisos activados, los deja a nombre de la cuenta con sesión
 * abierta: así no siguen llegando los avisos de otra cuenta que entró antes aquí.
 */
export function PushClaim() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("Notification" in window) || Notification.permission !== "granted") return;
    navigator.serviceWorker
      .getRegistration("/sw.js")
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => sub && savePushSubscriptionAction(sub.toJSON()))
      .catch(() => {});
  }, []);
  return null;
}
