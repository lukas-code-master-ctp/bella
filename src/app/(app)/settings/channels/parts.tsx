import Link from "next/link";
import { ArrowLeft, CircleCheck, CircleDashed, Sparkles } from "lucide-react";
import { CREDENTIALS } from "@/lib/credentials";
import { buttonClass } from "@/components/ui";

/** Credenciales que pide un canal, con cuáles ya están cargadas. */
export function EnvList({ keys, missing }: { keys: readonly string[]; missing: string[] }) {
  return (
    <ul className="space-y-2 text-sm">
      {CREDENTIALS.filter((c) => keys.includes(c.key)).map(({ key, label, help }) => (
        <li key={key} className="flex gap-2">
          {missing.includes(key) ? (
            <CircleDashed aria-label="Falta" className="mt-0.5 size-4 shrink-0 text-slate-400" />
          ) : (
            <CircleCheck aria-label="Configurada" className="mt-0.5 size-4 shrink-0 text-emerald-600" />
          )}
          <span>
            <span className="font-medium text-slate-900">{label}</span>
            <span className="block text-xs text-slate-600">{help}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Webhook({ url, where, fields }: { url: string; where: string; fields: string }) {
  return (
    <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
      <p className="font-medium text-slate-800">URL del webhook (en Meta: {where})</p>
      <code className="mt-1 block break-all font-mono text-[13px] text-brand-700">{url}</code>
      <p className="mt-1 text-xs text-slate-600">
        Token de verificación: el mismo que guardaste en Credenciales. Suscribe {fields}.
      </p>
    </div>
  );
}

/** Acciones de la cabecera de la pantalla de un canal: volver a Canales y conectar con Claude. */
export function ChannelPageActions() {
  return (
    <div className="flex flex-wrap gap-2">
      <Link href="/settings/channels" className={buttonClass("ghost")}>
        <ArrowLeft aria-hidden />
        Canales
      </Link>
      <Link href="/settings/claude" className={buttonClass("secondary")}>
        <Sparkles aria-hidden />
        Conectar Meta con Claude
      </Link>
    </div>
  );
}

/** Texto de cómo se conecta un canal de Meta a mano. */
export function ManualSetupHint() {
  return (
    <p className="mb-4 text-sm text-slate-600">
      Carga los datos en{" "}
      <Link href="/settings/credentials" className="font-medium text-brand-700 hover:underline">
        Credenciales
      </Link>{" "}
      y registra el webhook en la app de Meta, o deja que Claude lo haga por ti.
    </p>
  );
}
