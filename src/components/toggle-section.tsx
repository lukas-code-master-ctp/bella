"use client";

import { useState, type ComponentProps, type ReactNode } from "react";
import { ToggleRow } from "./settings-ui";

/**
 * Interruptor con las opciones que dependen de él debajo. Mientras está apagado, las opciones se ven
 * en gris y no se pueden usar (`inert`), pero siguen enviándose con el formulario, así que no se pierden.
 */
export function ToggleSection({
  children,
  defaultChecked,
  onChange,
  ...toggle
}: ComponentProps<typeof ToggleRow> & { children: ReactNode }) {
  const [on, setOn] = useState(!!defaultChecked);
  return (
    <>
      <ToggleRow
        {...toggle}
        defaultChecked={defaultChecked}
        onChange={(e) => {
          setOn(e.target.checked);
          onChange?.(e);
        }}
      />
      <div
        inert={!on}
        aria-disabled={!on}
        className={`space-y-5 transition-opacity duration-150 ${on ? "" : "select-none opacity-50 grayscale"}`}
      >
        {children}
      </div>
    </>
  );
}
