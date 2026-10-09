"use client";

import { useEffect, useState } from "react";
import { BellOff, BellRing, LoaderCircle } from "lucide-react";
import { Button, Card, CardHeader, FormMessage } from "@/components/ui";
import { deletePushSubscriptionAction, savePushSubscriptionAction } from "./actions";

type State = "loading" | "unsupported" | "denied" | "off" | "on";

function urlBase64ToUint8Array(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

const supported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** Activa o desactiva los avisos push en este navegador. */
export function PushToggle({ publicKey, isAdmin }: { publicKey: string | null; isAdmin: boolean }) {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supported()) return setState("unsupported");
    if (Notification.permission === "denied") return setState("denied");
    navigator.serviceWorker
      .getRegistration("/sw.js")
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => setState(sub ? "on" : "off"))
      .catch(() => setState("off"));
  }, []);

  async function enable() {
    if (!publicKey) return;
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
      await savePushSubscriptionAction(sub.toJSON());
      setState("on");
    } catch (e) {
      console.error(e);
      setError("No se pudieron activar los avisos en este navegador. Intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await deletePushSubscriptionAction(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
    } finally {
      setBusy(false);
    }
  }

  let description: React.ReactNode;
  if (!publicKey) {
    description = isAdmin
      ? "Falta configurar VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY en el servidor. Mientras tanto, los avisos quedan solo aquí."
      : "Los avisos al navegador aún no están configurados. Mientras tanto, revisa esta página.";
  } else if (state === "unsupported") {
    description = "Este navegador no permite avisos. En iPhone, agrega Bella a la pantalla de inicio y ábrela desde ahí.";
  } else if (state === "denied") {
    description = "Bloqueaste los avisos de Bella. Habilítalos en los permisos del sitio de tu navegador.";
  } else if (state === "on") {
    description = "Te llegará un aviso a este dispositivo aunque no tengas Bella abierta.";
  } else {
    description = "Recibe un aviso en este dispositivo cuando un lead te necesite, aunque no tengas Bella abierta.";
  }

  return (
    <Card className="h-fit p-5">
      <CardHeader title="Avisos en este dispositivo" description={description} icon={state === "on" ? <BellRing /> : <BellOff />} />
      {publicKey && (state === "off" || state === "on" || state === "loading") && (
        <Button
          variant={state === "on" ? "secondary" : "primary"}
          disabled={busy || state === "loading"}
          onClick={state === "on" ? disable : enable}
          className="w-full"
        >
          {busy || state === "loading" ? <LoaderCircle aria-hidden className="animate-spin" /> : state === "on" ? <BellOff aria-hidden /> : <BellRing aria-hidden />}
          {state === "on" ? "Desactivar en este dispositivo" : "Activar avisos"}
        </Button>
      )}
      {error && (
        <div className="mt-3">
          <FormMessage>{error}</FormMessage>
        </div>
      )}
    </Card>
  );
}
