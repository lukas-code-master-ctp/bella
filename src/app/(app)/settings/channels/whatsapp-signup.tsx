"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Plug } from "lucide-react";
import { Button, FormMessage } from "@/components/ui";
import { completeWhatsAppSignupAction } from "../actions";

type Config = { appId: string; configId: string; graphVersion: string };

type FB = {
  init(opts: Record<string, unknown>): void;
  login(cb: (res: { authResponse?: { code?: string } | null }) => void, opts: Record<string, unknown>): void;
};

declare global {
  interface Window {
    FB?: FB;
    fbAsyncInit?: () => void;
  }
}

const SDK_URL = "https://connect.facebook.net/es_LA/sdk.js";

/** Carga el SDK de Meta una sola vez. */
function loadSdk(config: Config): Promise<FB> {
  if (window.FB) return Promise.resolve(window.FB);
  return new Promise((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB!.init({ appId: config.appId, autoLogAppEvents: true, xfbml: false, version: config.graphVersion });
      resolve(window.FB!);
    };
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => reject(new Error("No se pudo cargar la ventana de Meta. Revisa si un bloqueador la está frenando."));
    document.body.appendChild(script);
  });
}

/**
 * Botón "Conectar con Meta" (registro integrado de WhatsApp). La ventana de Meta devuelve por
 * separado el código (en el callback de FB.login) y los ids del número (por postMessage), en
 * cualquier orden: con los dos se termina la conexión en el servidor.
 */
export function WhatsAppSignup({ config, connected }: { config: Config; connected: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "open" | "saving" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const got = useRef<{ code?: string; wabaId?: string; phoneNumberId?: string }>({});

  async function finishIfReady() {
    const { code, wabaId, phoneNumberId } = got.current;
    if (!code || !wabaId || !phoneNumberId) return;
    got.current = {};
    setState("saving");
    const res = await completeWhatsAppSignupAction({ code, wabaId, phoneNumberId }).catch(() => ({
      error: "No se pudo terminar la conexión. Vuelve a intentarlo.",
    }));
    if (res.error) {
      setError(res.error);
      setState("idle");
      return;
    }
    setState("done");
    router.refresh();
  }

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!event.origin.endsWith("facebook.com")) return;
      let msg: { type?: string; event?: string; data?: { phone_number_id?: string; waba_id?: string; error_message?: string } };
      try {
        msg = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (msg?.type !== "WA_EMBEDDED_SIGNUP") return;
      if (msg.event === "FINISH") {
        got.current.wabaId = msg.data?.waba_id;
        got.current.phoneNumberId = msg.data?.phone_number_id;
        void finishIfReady();
      } else if (msg.event === "CANCEL") {
        setState("idle");
      } else if (msg.event === "ERROR") {
        setError(msg.data?.error_message || "Meta no pudo terminar el registro.");
      } else if (msg.event?.startsWith("FINISH")) {
        setError("Ese tipo de cuenta no se puede conectar así. Elige un número para la API de WhatsApp.");
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function open() {
    setError(null);
    got.current = {};
    if (connected && !confirm("WhatsApp ya está conectado. ¿Conectar otro número en su lugar? El actual deja de recibir mensajes en Beliapp.")) {
      return;
    }
    try {
      const fb = await loadSdk(config);
      setState("open");
      fb.login(
        (res) => {
          const code = res.authResponse?.code;
          if (!code) {
            setState("idle");
            return;
          }
          // El código vence en 30 segundos: se usa apenas lleguen también los ids del número.
          got.current.code = code;
          void finishIfReady();
        },
        { config_id: config.configId, response_type: "code", override_default_response_type: true, extras: { setup: {} } },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo abrir la ventana de Meta.");
      setState("idle");
    }
  }

  return (
    <div className="space-y-2">
      <Button onClick={open} disabled={state === "open" || state === "saving"}>
        {state === "saving" ? <LoaderCircle aria-hidden className="animate-spin" /> : <Plug aria-hidden />}
        {state === "saving" ? "Conectando…" : connected ? "Conectar otro número con Meta" : "Conectar con Meta"}
      </Button>
      {state === "done" && <FormMessage tone="neutral">Listo: WhatsApp quedó conectado. Escríbele al número para probar.</FormMessage>}
      {error && <FormMessage>{error}</FormMessage>}
    </div>
  );
}
