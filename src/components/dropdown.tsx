"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Botón con un menú desplegable (role="menu"): se cierra con Esc, al hacer clic afuera o al
 * elegir; las flechas recorren las opciones. Las opciones son `DropdownItem` o enlaces/forms que
 * lleven role="menuitem".
 */
export function Dropdown({
  label,
  button,
  buttonClassName = "",
  align = "right",
  width = "w-60",
  children,
}: {
  /** Nombre accesible del botón. */
  label: string;
  button: ReactNode;
  buttonClassName?: string;
  align?: "left" | "right";
  width?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    wrapRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) return;
    const items = [...(wrapRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative" onKeyDown={onKeyDown} onClick={(e) => (e.target as HTMLElement).closest("[role=menuitem]") && setOpen(false)}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={buttonClassName}
      >
        {button}
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          className={`absolute top-full z-40 mt-1.5 ${width} ${align === "right" ? "right-0" : "left-0"} animate-fade-in rounded-xl border border-slate-200 bg-white p-1 shadow-lg`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
