"use client";

import type { ComponentProps } from "react";

/** Selector de un formulario de filtros (GET) que lo envía apenas cambia, sin botón "Ver". */
export function AutoSubmitSelect(props: ComponentProps<"select">) {
  return <select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}
