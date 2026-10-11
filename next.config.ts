import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  // Notas de voz del simulador (hasta 4 MB, ver AUDIO_MAX_BYTES).
  experimental: { serverActions: { bodySizeLimit: "5mb" } },
  // Archivos e Inventario ahora viven dentro de Conocimiento; Comentarios y Simulador, dentro de Chats.
  // Aquí y no con redirect() en una página: así también funcionan al navegar dentro de la app.
  async redirects() {
    return [
      { source: "/simulator", destination: "/chats/simulator", permanent: false },
      { source: "/comments", destination: "/chats/comments", permanent: false },
      { source: "/settings/files", destination: "/settings/knowledge/files", permanent: true },
      { source: "/settings/inventory", destination: "/settings/knowledge/inventory", permanent: true },
    ];
  },
};

export default nextConfig;
