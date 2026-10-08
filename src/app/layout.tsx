import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bella CRM",
  description: "CRM de leads con asistente IA",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
