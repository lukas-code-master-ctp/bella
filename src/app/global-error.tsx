"use client";

import { ErrorScreen } from "@/components/error-screen";
import "./globals.css";

/** Último recurso: errores en el layout raíz. Reemplaza todo el documento, por eso trae <html>. */
export default function GlobalError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="es">
      <body>
        <ErrorScreen {...props} />
      </body>
    </html>
  );
}
