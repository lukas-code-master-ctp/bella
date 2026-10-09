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
  };
}
