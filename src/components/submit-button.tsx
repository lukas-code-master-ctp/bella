"use client";

import { useFormStatus } from "react-dom";
import { Button } from "./ui";
import type { ComponentProps } from "react";

export function SubmitButton({
  pendingText,
  children,
  ...props
}: ComponentProps<typeof Button> & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} {...props}>
      {pending ? (pendingText ?? "Guardando…") : children}
    </Button>
  );
}
