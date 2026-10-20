"use client";

import { useState, useTransition } from "react";
import { LoaderCircle, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import { toast } from "@/components/toast";
import { deleteTemplateAction } from "../actions";
import { TemplateForm } from "../new/template-form";

/** Botón del encabezado; el formulario se abre bajo el encabezado, a todo el ancho. */
export function NewTemplate() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={open}>
        <Plus aria-hidden />
        Nueva plantilla
      </Button>
      {open && (
        <div className="w-full">
          <TemplateForm onClose={() => setOpen(false)} />
        </div>
      )}
    </>
  );
}

export function DeleteTemplateButton({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost-danger"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(`¿Borrar la plantilla ${name}? Meta no deja volver a usar este nombre por 30 días.`)) return;
        start(async () => {
          const res = await deleteTemplateAction(id, name);
          toast(res ? res.error : "Plantilla borrada", res ? "error" : "success");
        });
      }}
    >
      {pending ? <LoaderCircle aria-hidden className="animate-spin" /> : <Trash2 aria-hidden />}
      Borrar
    </Button>
  );
}
