import { CREDENTIALS, credentialStatus, type CredentialGroup } from "@/lib/credentials";
import { Badge, Card, CardHeader, inputClass, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { saveCredentialsAction } from "./actions";

const GROUPS: { id: CredentialGroup; title: string; description: string }[] = [
  { id: "whatsapp", title: "WhatsApp", description: "API oficial de WhatsApp Cloud, con la app de Meta de la empresa." },
  { id: "meta", title: "Meta", description: "App de Meta, página de Facebook, Instagram, anuncios y píxel." },
  { id: "ai", title: "Inteligencia artificial", description: "La clave del proveedor que se elige en Asistente IA." },
  { id: "email", title: "Correo", description: "Para mandar el resumen semanal." },
];

export default async function CredentialsPage() {
  const status = new Map((await credentialStatus()).map((s) => [s.key, s]));
  return (
    <>
      <PageHeader
        title="Credenciales"
        description="Tokens y claves de las cuentas de la empresa. Se guardan cifrados y nunca se vuelven a mostrar completos: para cambiar uno, pega el nuevo; si dejas el campo vacío, queda como está."
      />
      <form action={saveCredentialsAction} className="space-y-6">
        {GROUPS.map((g) => (
          <Card key={g.id} className="p-5">
            <CardHeader title={g.title} description={g.description} />
            <div className="space-y-5">
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
            </div>
          </Card>
        ))}
        <SubmitButton>Guardar credenciales</SubmitButton>
      </form>
    </>
  );
}
