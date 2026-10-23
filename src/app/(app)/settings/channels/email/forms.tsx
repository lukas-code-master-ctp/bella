"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";
import { Field, FormMessage, inputClass } from "@/components/ui";
import { PanelBody, PanelFooter } from "@/components/settings-ui";
import { SubmitButton } from "@/components/submit-button";
import { checkEmailDomainAction, connectEmailDomainAction, updateEmailSenderAction } from "../../actions";

function SenderFields({ fromName, fromLocal, replyTo, domain }: { fromName: string; fromLocal: string; replyTo: string; domain?: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Nombre del remitente" hint="Lo que ven las personas en su bandeja de entrada.">
        <input name="fromName" required defaultValue={fromName} maxLength={80} className={inputClass} />
      </Field>
      <Field label="Dirección del remitente" hint={domain ? `Va antes de @${domain}.` : "Va antes de la @ de tu dominio."}>
        <input name="fromLocal" required defaultValue={fromLocal} maxLength={64} placeholder="noticias" className={inputClass} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Respuestas a (opcional)" hint="Si alguien responde el correo, le llega a esta dirección. Vacío, al remitente.">
          <input name="replyTo" type="email" defaultValue={replyTo} placeholder="ventas@tuempresa.cl" className={inputClass} />
        </Field>
      </div>
    </div>
  );
}

export function ConnectDomainForm({ fromName }: { fromName: string }) {
  const [error, action] = useActionState(connectEmailDomainAction, null);
  return (
    <form action={action}>
      <PanelBody>
        <Field label="Dominio de envío" hint="Te recomendamos un subdominio solo para los envíos, por ejemplo noticias.tuempresa.cl.">
          <input name="domain" required placeholder="noticias.tuempresa.cl" autoCapitalize="none" spellCheck={false} className={inputClass} />
        </Field>
        <SenderFields fromName={fromName} fromLocal="noticias" replyTo="" />
        {error && <FormMessage>{error}</FormMessage>}
      </PanelBody>
      <PanelFooter note="Después te mostramos los registros DNS que debes agregar.">
        <SubmitButton pendingText="Conectando…">Conectar dominio</SubmitButton>
      </PanelFooter>
    </form>
  );
}

export function CheckDomainButton({ verified }: { verified: boolean }) {
  const [message, action] = useActionState(checkEmailDomainAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center justify-end gap-3">
      {message && <p className="mr-auto text-xs text-slate-600">{message}</p>}
      <SubmitButton variant={verified ? "secondary" : "primary"} pendingText="Revisando…">
        <RefreshCw aria-hidden />
        {verified ? "Revisar de nuevo" : "Ya los agregué, revisar"}
      </SubmitButton>
    </form>
  );
}

export function SenderForm(props: { fromName: string; fromLocal: string; replyTo: string; domain: string }) {
  const [error, action] = useActionState(updateEmailSenderAction, null);
  return (
    <form action={action}>
      <PanelBody>
        <SenderFields {...props} />
        {error && <FormMessage>{error}</FormMessage>}
      </PanelBody>
      <PanelFooter note={`Los correos salen como ${props.fromName} <${props.fromLocal}@${props.domain}>.`}>
        <SubmitButton toast="Cambios guardados">Guardar</SubmitButton>
      </PanelFooter>
    </form>
  );
}
