import type { MetadataRoute } from "next";

// Necesario para instalar Beliapp en la pantalla de inicio (en iPhone, los avisos push solo
// funcionan así).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Beliapp CRM",
    short_name: "Beliapp",
    start_url: "/funnel",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#2c8040",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
