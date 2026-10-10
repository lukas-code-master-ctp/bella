import type { MessageAuthor } from "@prisma/client";

/**
 * Quién atiende el lead ahora:
 * - "waiting": el cliente escribió y nadie le ha respondido. Si lo atiende un humano, apenas
 *   escribe; si responde la IA, solo cuando lleva más de `AI_GRACE_MS` sin respuesta (la IA
 *   espera a que el cliente deje de escribir, así que unos segundos de silencio son normales).
 * - "human": lo atiende un ejecutivo (la IA está pausada o el lead está en una etapa de
 *   atención humana).
 * - "ai": lo atiende la IA.
 */
export type Attention = "waiting" | "human" | "ai";

export const AI_GRACE_MS = 10 * 60_000;

export type AttentionInput = {
  aiEnabled: boolean;
  requiresHuman: boolean;
  lastMessage: { author: MessageAuthor; createdAt: Date } | null;
};

export function attentionOf({ aiEnabled, requiresHuman, lastMessage }: AttentionInput, now = new Date()): Attention {
  const human = !aiEnabled || requiresHuman;
  if (lastMessage?.author === "CONTACT" && (human || now.getTime() - lastMessage.createdAt.getTime() > AI_GRACE_MS)) {
    return "waiting";
  }
  return human ? "human" : "ai";
}
