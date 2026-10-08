"use client";

import { useFormStatus } from "react-dom";
import { LoaderCircle } from "lucide-react";
import { Button } from "./ui";
import type { ComponentProps } from "react";

export function SubmitButton({
  pendingText,
  confirm,
  children,
  onClick,
  disabled,
  ...props
}: ComponentProps<typeof Button> & { pendingText?: string; confirm?: string }) {
  const { pending } = useFormStatus();
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
