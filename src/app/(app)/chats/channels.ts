import type { Channel } from "@prisma/client";

/** Canales con el color de su punto en la bandeja de chats. */
export const CHANNEL_OPTIONS: { value: Channel; label: string; dot: string }[] = [
  { value: "WHATSAPP", label: "WhatsApp", dot: "bg-emerald-500" },
  { value: "INSTAGRAM", label: "Instagram", dot: "bg-pink-500" },
  { value: "FACEBOOK", label: "Facebook", dot: "bg-sky-600" },
  { value: "SIMULATOR", label: "Simulador", dot: "bg-slate-400" },
];
