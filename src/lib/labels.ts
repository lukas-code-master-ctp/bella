import type { Channel } from "@prisma/client";

export const CHANNEL_LABEL: Record<Channel, string> = {
  SIMULATOR: "Simulador",
  WHATSAPP: "WhatsApp",
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
};
