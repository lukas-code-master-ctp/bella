import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  // Notas de voz del simulador (hasta 4 MB, ver AUDIO_MAX_BYTES).
  experimental: { serverActions: { bodySizeLimit: "5mb" } },
};

export default nextConfig;
