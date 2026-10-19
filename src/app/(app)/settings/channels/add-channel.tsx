"use client";

import { useRef } from "react";
import Link from "next/link";
import { ChevronRight, Plus, Sparkles, X } from "lucide-react";
import { Badge, buttonClass } from "@/components/ui";
import { ChannelIcon, type ChannelKind } from "./channel-icon";

export type ChannelOption = {
  kind: ChannelKind;
  name: string;
  description: string;
  connected: boolean;
  href: string;
};

/** Botón "Agregar canal": abre un modal con los canales disponibles y cada uno lleva a su configuración. */
export function AddChannel({ options }: { options: ChannelOption[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = () => ref.current?.close();

  return (
    <>
      <button type="button" onClick={() => ref.current?.showModal()} className={buttonClass("primary", "md", "mt-5 w-full")}>
        <Plus aria-hidden />
        Agregar canal
      </button>
      <dialog
        ref={ref}
        onClick={(e) => e.target === ref.current && close()}
        aria-labelledby="add-channel-title"
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl bg-white p-0 shadow-xl backdrop:bg-slate-900/40 open:animate-pop"
      >
        <div className="max-h-[85dvh] overflow-y-auto p-5">
          <div className="mb-4 flex items-start gap-3">
            <div className="flex-1">
              <h2 id="add-channel-title" className="text-base font-semibold text-slate-900">
                Agregar canal
              </h2>
              <p className="text-sm text-slate-600">Elige por dónde te escriben los clientes. Todo llega al mismo funnel y chat.</p>
            </div>
            <button
              type="button"
              aria-label="Cerrar"
              onClick={close}
              className="-mr-2 -mt-2 flex size-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              <X aria-hidden className="size-5" />
            </button>
          </div>
          <ul className="space-y-2">
            {options.map((o) => (
              <li key={o.kind}>
                <Link
                  href={o.href}
                  onClick={close}
                  className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 transition-colors duration-150 hover:border-brand-200 hover:bg-brand-50/40 focus-visible:outline-2 focus-visible:outline-brand-600"
                >
                  <ChannelIcon kind={o.kind} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      {o.name}
                      {o.connected ? <Badge tone="success">Conectado</Badge> : <Badge>Sin conectar</Badge>}
                    </span>
                    <span className="block text-xs text-slate-600">{o.description}</span>
                  </span>
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-slate-400" />
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <p className="text-xs text-slate-600">¿Prefieres que Claude conecte Meta por ti?</p>
            <Link href="/settings/claude" onClick={close} className={buttonClass("secondary", "sm")}>
              <Sparkles aria-hidden />
              Conectar Meta con Claude
            </Link>
          </div>
        </div>
      </dialog>
    </>
  );
}
