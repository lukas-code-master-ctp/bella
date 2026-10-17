"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Ban, Bot, BotOff, CircleX, Ellipsis, LoaderCircle, LockOpen, Merge, RotateCcw, Trophy, X } from "lucide-react";
import { Button, FormMessage, inputClass } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { toast } from "@/components/toast";
import {
  blockContactAction,
  closeLeadAction,
  leadDuplicatesAction,
  mergeIntoLeadAction,
  reopenLeadAction,
  toggleAiAction,
  unblockContactAction,
} from "./actions";

type Dialog = "WON" | "LOST" | "block" | "merge";
type Duplicate = Awaited<ReturnType<typeof leadDuplicatesAction>>[number];

/**
 * Menú ⋯ de la ficha con las acciones que cierran o cambian el lead entero (ganar, perder,
 * reabrir, bloquear, fusionar). Viven aquí y no en la columna lateral para que no se toquen por
 * error; las que piden datos abren un diálogo.
 */
export function LeadMenu({
  leadId,
  isOpen,
  canReopen,
  blocked,
  canMerge,
  aiEnabled,
}: {
  leadId: string;
  isOpen: boolean;
  aiEnabled: boolean;
  /** Cerrado y sin otro lead abierto del mismo contacto. */
  canReopen: boolean;
  blocked: boolean;
  canMerge: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [pending, start] = useTransition();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    wrapRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [menuOpen]);

  useEffect(() => {
    if (dialog) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [dialog]);

  function onMenuKey(e: React.KeyboardEvent) {
    const items = [...(wrapRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.stopPropagation();
      setMenuOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
    } else if (e.key === "Tab") {
      setMenuOpen(false);
    }
  }

  function choose(action: Dialog | (() => Promise<void>)) {
    setMenuOpen(false);
    if (typeof action === "function") start(action);
    else setDialog(action);
  }

  const close = () => setDialog(null);

  return (
    <div ref={wrapRef} className="relative" onKeyDown={menuOpen ? onMenuKey : undefined}>
      <button
        ref={buttonRef}
        type="button"
        aria-label="Más acciones del lead"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-busy={pending}
        onClick={() => setMenuOpen((v) => !v)}
        className={`flex size-10 items-center justify-center rounded-lg text-slate-600 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-brand-600 ${
          menuOpen ? "bg-slate-100 text-slate-900" : ""
        } ${pending ? "opacity-60" : ""}`}
      >
        <Ellipsis aria-hidden className="size-5" />
      </button>

      {menuOpen && (
        <div
          role="menu"
          aria-label="Acciones del lead"
          className="absolute right-0 top-full z-30 mt-1 w-60 animate-fade-in rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
        >
          {isOpen ? (
            <>
              <MenuItem icon={<Trophy className="text-emerald-600" />} onClick={() => choose("WON")}>
                Marcar ganado…
              </MenuItem>
              <MenuItem icon={<CircleX className="text-rose-600" />} onClick={() => choose("LOST")}>
                Marcar perdido…
              </MenuItem>
            </>
          ) : (
            canReopen && (
              <MenuItem icon={<RotateCcw />} onClick={() => choose(() => reopenLeadAction(leadId))}>
                Reabrir lead
              </MenuItem>
            )
          )}
          {isOpen && !blocked && (
            <MenuItem
              icon={aiEnabled ? <BotOff /> : <Bot className="text-emerald-600" />}
              onClick={() =>
                choose(async () => {
                  await toggleAiAction(leadId, !aiEnabled);
                  toast(aiEnabled ? "IA pausada" : "IA reactivada");
                })
              }
            >
              {aiEnabled ? "Pausar IA" : "Reactivar IA"}
            </MenuItem>
          )}
          {canMerge && (
            <MenuItem icon={<Merge />} onClick={() => choose("merge")}>
              Fusionar duplicados…
            </MenuItem>
          )}
          <div role="separator" className="my-1 h-px bg-slate-100" />
          {blocked ? (
            <MenuItem icon={<LockOpen />} onClick={() => choose(() => unblockContactAction(leadId))}>
              Desbloquear contacto
            </MenuItem>
          ) : (
            <MenuItem danger icon={<Ban />} onClick={() => choose("block")}>
              Bloquear contacto…
            </MenuItem>
          )}
        </div>
      )}

      <dialog
        ref={dialogRef}
        onClose={close}
        onClick={(e) => e.target === dialogRef.current && close()}
        aria-labelledby="lead-dialog-title"
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-white p-0 shadow-xl backdrop:bg-slate-900/40 open:animate-pop"
      >
        {dialog && (
          <div className="p-5">
            <div className="mb-4 flex items-start gap-3">
              <h2 id="lead-dialog-title" className="flex-1 text-base font-semibold text-slate-900">
                {dialog === "WON" ? "Marcar como ganado" : dialog === "LOST" ? "Marcar como perdido" : dialog === "block" ? "Bloquear contacto" : "Fusionar duplicados"}
              </h2>
              <button
                type="button"
                aria-label="Cerrar"
                onClick={close}
                className="-mr-2 -mt-2 flex size-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              >
                <X aria-hidden className="size-5" />
              </button>
            </div>
            {(dialog === "WON" || dialog === "LOST") && <CloseForm leadId={leadId} outcome={dialog} onDone={close} />}
            {dialog === "block" && <BlockForm leadId={leadId} onDone={close} />}
            {dialog === "merge" && <MergeForm leadId={leadId} onDone={close} />}
          </div>
        )}
      </dialog>
    </div>
  );
}

/**
 * Chip "IA pausada" de la cabecera. En un lead abierto es un botón: al tocarlo la IA vuelve a
 * atender y, si el cliente quedó esperando, le responde de inmediato.
 */
export function AiPausedChip({ leadId, canResume }: { leadId: string; canResume: boolean }) {
  const [pending, start] = useTransition();
  const content = (
    <>
      {pending ? <LoaderCircle aria-hidden className="animate-spin" /> : <BotOff aria-hidden />}
      {pending ? "Reactivando…" : "IA pausada"}
      {/* Se nota que es un botón y no solo un estado. */}
      {canResume && !pending && <span className="font-semibold text-brand-700">· Reactivar</span>}
    </>
  );
  const chip = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset bg-slate-100 text-slate-700 ring-slate-200 [&_svg]:size-3.5";
  if (!canResume) return <span className={chip}>{content}</span>;
  return (
    <button
      type="button"
      title="Reactivar la IA en este chat"
      disabled={pending}
      aria-busy={pending}
      onClick={() => {
        if (!window.confirm("¿Reactivar la IA? Volverá a responder sola en este chat.")) return;
        start(async () => {
          await toggleAiAction(leadId, true);
          toast("IA reactivada");
        });
      }}
      className={`${chip} cursor-pointer transition-colors duration-150 hover:bg-emerald-50 hover:text-emerald-800 hover:ring-emerald-200 focus-visible:outline-2 focus-visible:outline-brand-600 disabled:cursor-wait`}
    >
      {content}
    </button>
  );
}

function MenuItem({ icon, danger, onClick, children }: { icon: React.ReactNode; danger?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      onClick={onClick}
      className={`flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm font-medium outline-none transition-colors duration-150 [&_svg]:size-4 [&_svg]:shrink-0 ${
        danger ? "text-rose-700 hover:bg-rose-50 focus:bg-rose-50" : "text-slate-700 hover:bg-slate-100 focus:bg-slate-100"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

/** Monto de una venta que espera confirmación en una etapa de ganado; al guardarlo se cierra como ganado. */
export function ConfirmAmountForm({ leadId }: { leadId: string }) {
  const [error, action] = useActionState(async (prev: string | null, form: FormData) => {
    const result = await closeLeadAction(leadId, prev, form);
    if (!result) toast("Lead marcado como ganado");
    return result;
  }, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="outcome" value="WON" />
      <input type="hidden" name="amountRequired" value="on" />
      <div className="flex gap-2">
        <input name="amount" inputMode="numeric" required autoComplete="off" placeholder="Ej. 25.000.000" aria-label="Monto de la venta" className={inputClass} />
        <SubmitButton variant="success">
          <Trophy aria-hidden />
          Confirmar
        </SubmitButton>
      </div>
      {error && <FormMessage>{error}</FormMessage>}
    </form>
  );
}

function CloseForm({ leadId, outcome, onDone }: { leadId: string; outcome: "WON" | "LOST"; onDone: () => void }) {
  const [error, action] = useActionState(async (prev: string | null, form: FormData) => {
    const result = await closeLeadAction(leadId, prev, form);
    if (!result) {
      toast(outcome === "WON" ? "Lead marcado como ganado" : "Lead marcado como perdido");
      onDone();
    }
    return result;
  }, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="outcome" value={outcome} />
      {outcome === "WON" ? (
        <label className="block text-sm font-medium text-slate-700">
          Monto de la venta <span className="font-normal text-slate-500">(opcional)</span>
          <input name="amount" inputMode="numeric" autoComplete="off" placeholder="Ej. 25.000.000" autoFocus className={`${inputClass} mt-1.5`} />
        </label>
      ) : (
        <label className="block text-sm font-medium text-slate-700">
          Motivo de pérdida
          <input name="lostReason" required autoComplete="off" placeholder="Ej. compró en otro lado" autoFocus className={`${inputClass} mt-1.5`} />
        </label>
      )}
      {error && <FormMessage>{error}</FormMessage>}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" type="button" onClick={onDone}>
          Cancelar
        </Button>
        <SubmitButton variant={outcome === "WON" ? "success" : "danger"}>
          {outcome === "WON" ? <Trophy aria-hidden /> : <CircleX aria-hidden />}
          Marcar {outcome === "WON" ? "ganado" : "perdido"}
        </SubmitButton>
      </div>
    </form>
  );
}

function BlockForm({ leadId, onDone }: { leadId: string; onDone: () => void }) {
  return (
    <form
      action={async (form) => {
        await blockContactAction(leadId, form);
        toast("Contacto bloqueado");
        onDone();
      }}
      className="space-y-3"
    >
      <p className="text-sm text-slate-600">
        Sus leads abiertos se cierran como perdidos y sus mensajes nuevos se descartan: ni la IA ni el equipo le responden.
      </p>
      <label className="block text-sm font-medium text-slate-700">
        Motivo <span className="font-normal text-slate-500">(opcional)</span>
        <input name="reason" autoComplete="off" placeholder="Ej. spam" autoFocus className={`${inputClass} mt-1.5`} />
      </label>
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" type="button" onClick={onDone}>
          Cancelar
        </Button>
        <SubmitButton variant="danger" pendingText="Bloqueando…">
          <Ban aria-hidden />
          Bloquear
        </SubmitButton>
      </div>
    </form>
  );
}

function MergeForm({ leadId, onDone }: { leadId: string; onDone: () => void }) {
  const [duplicates, setDuplicates] = useState<Duplicate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    leadDuplicatesAction(leadId).then((d) => live && setDuplicates(d));
    return () => {
      live = false;
    };
  }, [leadId]);

  if (!duplicates) return <p className="py-2 text-sm text-slate-500">Buscando contactos con el mismo teléfono o correo…</p>;
  if (!duplicates.length) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-slate-600">No hay otros contactos con el mismo teléfono o correo.</p>
        <div className="flex justify-end">
          <Button variant="secondary" type="button" onClick={onDone}>
            Entendido
          </Button>
        </div>
      </div>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const ids = new FormData(e.currentTarget).getAll("id").map(String);
        if (!ids.length) return setError("Elige al menos un contacto.");
        start(async () => {
          const result = await mergeIntoLeadAction(leadId, ids);
          setError(result);
          if (!result) onDone();
        });
      }}
      className="space-y-3"
    >
      <p className="text-sm text-slate-600">
        Sus leads, etiquetas y datos pasan a este contacto y los duplicados se borran. Si quedan dos leads abiertos, se conserva el más nuevo.
      </p>
      <fieldset className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        <legend className="sr-only">Contactos a fusionar</legend>
        {duplicates.map((d) => (
          <label key={d.id} className="flex cursor-pointer items-start gap-3 px-3 py-2.5 text-sm hover:bg-slate-50">
            <input type="checkbox" name="id" value={d.id} defaultChecked className="mt-0.5 size-4 accent-brand-600" />
            <span className="min-w-0">
              <span className="block font-medium text-slate-900">{d.name}</span>
              <span className="block text-xs text-slate-600">
                {[d.detail, d.leads === 1 ? "1 lead" : `${d.leads} leads`].filter(Boolean).join(" · ")}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      {error && <FormMessage>{error}</FormMessage>}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" type="button" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          <Merge aria-hidden />
          {pending ? "Fusionando…" : "Fusionar"}
        </Button>
      </div>
    </form>
  );
}
