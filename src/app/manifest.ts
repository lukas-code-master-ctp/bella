import type { MetadataRoute } from "next";

// Necesario para instalar Bella en la pantalla de inicio (en iPhone, los avisos push solo
// funcionan así).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Bella CRM",
    short_name: "Bella",
    start_url: "/funnel",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#7c3aed",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
