"use client";

import { useActionState, useState, useTransition } from "react";
import type { Channel } from "@prisma/client";
import { Merge } from "lucide-react";
import { Badge, Button, Field, FormMessage, inputClass } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { CHANNEL_LABEL } from "@/lib/labels";
import { importContactsAction, mergeContactsAction, type ImportState } from "./actions";

export function ImportForm() {
  const [state, action] = useActionState<ImportState, FormData>(importContactsAction, null);
  return (
    <form action={action} className="mt-4 space-y-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
        <Field label="Archivo CSV">
          <input name="file" type="file" accept=".csv,text/csv" required className={inputClass} />
        </Field>
        <Field label="Código de país" hint="Para números sin código, ej. 56">
          <input name="countryCode" inputMode="numeric" placeholder="56" className={inputClass} />
        </Field>
      </div>
      <SubmitButton pendingText="Importando…">Importar</SubmitButton>
      {state && "error" in state && <FormMessage>{state.error}</FormMessage>}
      {state && !("error" in state) && (
        <div className="space-y-1 text-sm">
          <FormMessage tone="neutral">
            {state.created} nuevos, {state.updated} actualizados
            {state.skipped > 0 && `, ${state.skipped} omitidos`}.
          </FormMessage>
          {state.errors.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-rose-700">
              {state.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
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
    <li className="space-y-2 py-3">
      <ul className="space-y-1 text-sm">
        {contacts.map((c, i) => (
          <li key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium text-slate-900">{c.name}</span>
            {i === 0 && <Badge tone="brand">Se conserva</Badge>}
            <span className="text-slate-600">{[c.phone, c.email].filter(Boolean).join(" · ")}</span>
            <span className="text-xs text-slate-500">
              {c.linked ? CHANNEL_LABEL[c.channel] : "Sin canal"} · {c.leads === 1 ? "1 lead" : `${c.leads} leads`} · {c.createdAt}
            </span>
          </li>
        ))}
      </ul>
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
        {pending ? "Fusionando…" : "Fusionar"}
      </Button>
      {error && <FormMessage>{error}</FormMessage>}
    </li>
  );
}
