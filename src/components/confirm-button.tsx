"use client";

import type { ComponentProps } from "react";

/** Botón de envío que pide confirmación antes de una acción destructiva. */
export function ConfirmButton({ message, onClick, ...props }: ComponentProps<"button"> & { message: string }) {
  return (
    <button
      type="submit"
      {...props}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
        onClick?.(e);
      }}
    />
  );
}
