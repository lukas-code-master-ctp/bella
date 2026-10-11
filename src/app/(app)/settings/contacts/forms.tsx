"use client";

import { useActionState, useState, useTransition } from "react";
import type { Channel } from "@prisma/client";
import { CircleCheck, FileSpreadsheet, Merge, Upload } from "lucide-react";
import { Badge, Button, Field, FormMessage, inputClass } from "@/components/ui";
import { PanelBody, PanelFooter } from "@/components/settings-ui";
import { SubmitButton } from "@/components/submit-button";
import { CHANNEL_LABEL } from "@/lib/labels";
import { importContactsAction, mergeContactsAction, type ImportState } from "./actions";

export function ImportForm() {
  const [state, action] = useActionState<ImportState, FormData>(importContactsAction, null);
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <form action={action}>
      <PanelBody>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
          <label className="relative flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center transition-colors duration-150 hover:border-brand-400 hover:bg-brand-50/40 has-[:focus-visible]:border-brand-500">
            <FileSpreadsheet aria-hidden className="size-7 text-brand-600" />
            <span className="text-sm font-semibold text-slate-900">{picked ?? "Elige o arrastra el archivo CSV"}</span>
            <span className="text-xs text-slate-600">Separado por comas, con nombres de columna en la primera fila</span>
            <input
              name="file"
              type="file"
              accept=".csv,text/csv"
              required
              aria-label="Archivo CSV"
              onChange={(e) => setPicked(e.target.files?.[0]?.name ?? null)}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
          <Field label="Código de país" hint="Para números sin código, ej. 56">
            <input name="countryCode" inputMode="numeric" placeholder="56" className={inputClass} />
          </Field>
        </div>
        {state && !("error" in state) && (
          <div className="animate-rise space-y-2 rounded-lg bg-emerald-50 p-3 ring-1 ring-inset ring-emerald-200">
            <p role="status" className="flex items-center gap-2 text-sm font-medium text-emerald-900">
              <CircleCheck aria-hidden className="size-4 text-emerald-600" />
              {state.created} nuevos, {state.updated} actualizados
              {state.skipped > 0 && `, ${state.skipped} omitidos`}.
            </p>
            {state.errors.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-9 text-xs text-rose-700">
                {state.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </PanelBody>
      <PanelFooter note={state && "error" in state && <FormMessage>{state.error}</FormMessage>}>
        <SubmitButton pendingText="Importando…">
          <Upload aria-hidden />
          Importar
        </SubmitButton>
      </PanelFooter>
    </form>
  );
}

type Dup = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  channel: Channel;
  createdAt: string;
  leads: number;
  linked: boolean;
};

export function DuplicateGroup({ contacts }: { contacts: Dup[] }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [keep, ...rest] = contacts;
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-4">
      <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
        {contacts.map((c, i) => (
          <li key={c.id} className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${i === 0 ? "" : "pl-4 text-slate-600"}`}>
            <span className={i === 0 ? "font-semibold text-slate-900" : "font-medium"}>{c.name}</span>
            {i === 0 && <Badge tone="brand">Se conserva</Badge>}
            <span className="text-slate-600">{[c.phone, c.email].filter(Boolean).join(" · ")}</span>
            <span className="text-xs text-slate-500">
              {c.linked ? CHANNEL_LABEL[c.channel] : "Sin canal"} · {c.leads === 1 ? "1 lead" : `${c.leads} leads`} · {c.createdAt}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-col items-end gap-1">
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(await mergeContactsAction(keep.id, rest.map((c) => c.id)));
            })
          }
        >
          <Merge aria-hidden />
          {pending ? "Fusionando…" : `Fusionar ${contacts.length}`}
        </Button>
        {error && <FormMessage>{error}</FormMessage>}
      </div>
    </li>
  );
}
