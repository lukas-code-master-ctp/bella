import { Bot, MessageCircle, Share2 } from "lucide-react";
import type { ReactNode } from "react";
import { CREDENTIALS, credentialStatus, type CredentialGroup } from "@/lib/credentials";
import { Badge, inputClass, PageHeader } from "@/components/ui";
import { Panel, PanelBody, SaveBar } from "@/components/settings-ui";
import { SubmitButton } from "@/components/submit-button";
import { saveCredentialsAction } from "./actions";

const GROUPS: { id: CredentialGroup; title: string; description: string; icon: ReactNode }[] = [
  { id: "whatsapp", title: "WhatsApp", description: "API oficial de WhatsApp Cloud, con la app de Meta de la empresa.", icon: <MessageCircle /> },
  { id: "meta", title: "Meta", description: "App de Meta, página de Facebook, Instagram, anuncios y píxel.", icon: <Share2 /> },
  { id: "ai", title: "Inteligencia artificial", description: "La clave del proveedor que se elige en Asistente IA.", icon: <Bot /> },
];

export default async function CredentialsPage() {
  const status = new Map((await credentialStatus()).map((s) => [s.key, s]));
  return (
    <div className="space-y-6">
      <PageHeader
        title="Credenciales"
        description="Tokens y claves de las cuentas de la empresa. Se guardan cifrados y nunca se vuelven a mostrar completos: para cambiar uno, pega el nuevo; si dejas el campo vacío, queda como está."
      />
      <form action={saveCredentialsAction} className="space-y-6">
        {GROUPS.map((g) => (
          <Panel key={g.id} icon={g.icon} title={g.title} description={g.description}>
            <PanelBody>
              {CREDENTIALS.filter((c) => c.group === g.id).map((c) => {
                const s = status.get(c.key);
                return (
                  <div key={c.key} className="space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label htmlFor={c.key} className="text-sm font-medium text-slate-800">
                        {c.label}
                      </label>
                      {s?.source === "app" ? (
                        <Badge tone="success">Guardada</Badge>
                      ) : s?.source === "env" ? (
                        <Badge tone="brand">En variables del servidor</Badge>
                      ) : (
                        <Badge>Falta</Badge>
                      )}
                    </div>
                    <input
                      id={c.key}
                      name={c.key}
                      type={c.secret ? "password" : "text"}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={s?.preview ?? ""}
                      className={`${inputClass} font-mono`}
                    />
                    <p className="text-xs text-slate-600">{c.help}</p>
                    {s?.source === "app" && (
                      <label className="flex items-center gap-2 text-xs text-slate-600">
                        <input type="checkbox" name="clear" value={c.key} className="size-4 rounded border-slate-300 accent-brand-600" />
                        Quitar la guardada
                      </label>
                    )}
                  </div>
                );
              })}
            </PanelBody>
          </Panel>
        ))}
        <SaveBar note="Las credenciales guardadas aquí reemplazan a las variables del servidor.">
          <SubmitButton toast="Credenciales guardadas">Guardar credenciales</SubmitButton>
        </SaveBar>
      </form>
    </div>
  );
}
