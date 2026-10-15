"use client";

import { useFormStatus } from "react-dom";
import { LoaderCircle } from "lucide-react";
import { Button } from "./ui";
import { useToastWhenSent } from "./toast";
import type { ComponentProps } from "react";

export function SubmitButton({
  pendingText,
  confirm,
  toast,
  children,
  onClick,
  disabled,
  ...props
}: ComponentProps<typeof Button> & {
  pendingText?: string;
  confirm?: string;
  /** Aviso flotante al terminar de enviar (ej. "Cambios guardados"). */
  toast?: string;
}) {
  const { pending } = useFormStatus();
  useToastWhenSent(toast);
  return (
    <Button
      {...props}
      type="submit"
      disabled={pending || disabled}
      aria-busy={pending}
      onClick={(e) => {
        // Acciones destructivas: pide confirmación antes de enviar.
        if (confirm && !window.confirm(confirm)) e.preventDefault();
        onClick?.(e);
      }}
    >
      {pending ? (
        <>
          <LoaderCircle aria-hidden className="animate-spin" />
          {pendingText ?? (props.size === "icon" ? null : "Guardando…")}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
