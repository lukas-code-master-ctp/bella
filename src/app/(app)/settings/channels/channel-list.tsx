"use client";

import { useState } from "react";
import { Bot, BotOff, CircleCheck, CircleDashed, Search, Settings2 } from "lucide-react";
import { buttonClass, inputClass } from "@/components/ui";
import { ChannelIcon, type ChannelKind } from "./channel-icon";

export type ChannelRow = {
  kind: ChannelKind;
  group: string;
  name: string;
  detail: string;
  connected: boolean;
  aiOn: boolean;
  /** Ancla de la tarjeta de configuración de este canal. */
  setup: string;
};

/** Lista de canales agrupada por red, con buscador (como la de Vambe). */
export function ChannelList({ rows }: { rows: ChannelRow[] }) {
  const [q, setQ] = useState("");
  const term = q.trim().toLowerCase();
  const shown = term ? rows.filter((r) => `${r.group} ${r.name} ${r.detail}`.toLowerCase().includes(term)) : rows;
  const groups = [...new Set(shown.map((r) => r.group))];

  return (
    <div className="space-y-4">
      <label className="relative block">
        <span className="sr-only">Buscar canal</span>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar canal"
          className={`${inputClass} pr-10`}
        />
        <Search aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
      </label>

      {groups.length === 0 && <p className="py-6 text-center text-sm text-slate-500">Ningún canal coincide con la búsqueda.</p>}

      {groups.map((group) => (
        <section key={group} aria-label={group}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{group}</h3>
          <ul className="space-y-2">
            {shown
              .filter((r) => r.group === group)
              .map((r) => (
                <li
                  key={r.kind}
                  className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3 transition-colors duration-150 hover:border-slate-200 hover:bg-white"
                >
                  <ChannelIcon kind={r.kind} />
                  <div className="ml-1 min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{r.name}</p>
                    <p className="truncate text-xs text-slate-600">{r.detail}</p>
                  </div>
                  <span
                    title={r.aiOn ? "La asistente responde sola" : "La asistente no responde sola"}
                    className={`flex size-8 items-center justify-center rounded-lg [&_svg]:size-4 ${r.aiOn ? "bg-brand-50 text-brand-700" : "text-slate-400"}`}
                  >
                    {r.aiOn ? <Bot aria-label="Asistente encendida" /> : <BotOff aria-label="Asistente apagada" />}
                  </span>
                  <span
                    title={r.connected ? "Conectado" : "Sin conectar: faltan credenciales"}
                    className={`flex size-8 items-center justify-center [&_svg]:size-4 ${r.connected ? "text-emerald-600" : "text-slate-400"}`}
                  >
                    {r.connected ? <CircleCheck aria-label="Conectado" /> : <CircleDashed aria-label="Sin conectar" />}
                  </span>
                  <a href={r.setup} title="Configurar" className={buttonClass("ghost", "icon", "size-8")}>
                    <Settings2 aria-label={`Configurar ${r.name}`} />
                  </a>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
