import { CircleAlert, CircleCheck, CircleDashed } from "lucide-react";
import type { ReactNode } from "react";
import { checkWhatsApp } from "@/lib/channels/whatsapp";
import { getWhatsAppWebhookLog } from "@/lib/domain/channels";
import { formatLocal } from "@/lib/dates";
import { buttonClass } from "@/components/ui";
import { subscribeWhatsAppAction } from "../actions";

function Row({ ok, title, children }: { ok: boolean | null; title: string; children?: ReactNode }) {
  const Icon = ok === null ? CircleDashed : ok ? CircleCheck : CircleAlert;
  const color = ok === null ? "text-slate-400" : ok ? "text-emerald-600" : "text-rose-600";
  return (
    <li className="flex gap-2">
      <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${color}`} />
      <div className="min-w-0">
        <p className="font-medium text-slate-800">{title}</p>
        {children && <div className="text-xs text-slate-600">{children}</div>}
      </div>
    </li>
  );
}

/**
 * Diagnóstico de WhatsApp: qué dice Meta del número y de la suscripción de la app, y cuál fue el
 * último aviso que llegó al webhook. Responde a "escribí al número y no llegó nada a Bella".
 */
export async function WhatsAppStatus() {
  const [check, log] = await Promise.all([checkWhatsApp(), getWhatsAppWebhookLog()]);
  const phone = "error" in check.phone ? null : check.phone;
  const phoneError = "error" in check.phone ? check.phone.error : null;
  const notCloud = phone?.platform && phone.platform !== "CLOUD_API";

  return (
    <div className="mt-4 rounded-lg border border-slate-200 p-3 text-sm">
      <p className="mb-3 font-medium text-slate-800">Diagnóstico de la conexión</p>
      <ul className="space-y-3">
        <Row ok={phone ? !notCloud : false} title="Número en Meta">
          {phone ? (
            <>
              {phone.display ?? "Sin número"}
              {phone.name && ` · ${phone.name}`}
              {notCloud && (
                <span className="block text-rose-700">
                  El número no está en la API de WhatsApp Cloud ({phone.platform}). Si sigue conectado a otro
                  proveedor, hay que desconectarlo de ahí y registrarlo en la app de Meta de Bella.
                </span>
              )}
            </>
          ) : (
            phoneError
          )}
        </Row>
        <Row ok={check.subscribed} title="App suscrita a la cuenta de WhatsApp Business">
          {check.subscribed === false && (
            <>
              <span className="block">
                Meta no le manda a Bella los mensajes de esta cuenta hasta que la app esté suscrita.
              </span>
              <form action={subscribeWhatsAppAction} className="mt-2">
                <input type="hidden" name="wabaId" value={check.wabaId ?? ""} />
                <button className={buttonClass("primary", "sm")}>Suscribir la app</button>
              </form>
            </>
          )}
          {check.subscribed === null && (check.error ?? "No se pudo revisar.")}
          {check.subscribed && check.wabaId && `Cuenta ${check.wabaId}`}
        </Row>
        <Row ok={log ? log.result === "ok" : null} title="Último aviso de Meta al webhook">
          {log ? (
            <>
              {formatLocal(new Date(log.at))} · {log.detail}
              <span className="block">
                {log.lastMessageAt
                  ? `Último mensaje de un cliente: ${formatLocal(new Date(log.lastMessageAt))}.`
                  : "Todavía no llega ningún mensaje de un cliente."}
              </span>
            </>
          ) : (
            "Bella no ha recibido ningún aviso de Meta. Revisa que el webhook esté verificado con la URL de arriba, que el campo messages esté suscrito y que la app esté en modo Activo."
          )}
        </Row>
      </ul>
    </div>
  );
}
