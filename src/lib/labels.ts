import type { Channel, FieldType } from "@prisma/client";

export const CHANNEL_LABEL: Record<Channel, string> = {
  SIMULATOR: "Simulador",
  WHATSAPP: "WhatsApp",
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
};

export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  TEXT: "Texto",
  NUMBER: "Número",
  OPTIONS: "Opciones",
  RUT: "RUT",
};
