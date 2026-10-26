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
  /** Un ejecutivo marcó que no requiere respuesta: los mensajes hasta esta fecha ya no esperan. */
  noReplyNeededAt?: Date | null;
  /** Está en una etapa de descarte (ej. "Perdidos"): ya no espera respuesta aunque siga abierto. */
  discarded?: boolean;
};

export function attentionOf({ aiEnabled, requiresHuman, lastMessage, noReplyNeededAt, discarded }: AttentionInput, now = new Date()): Attention {
  const human = !aiEnabled || requiresHuman;
  const dismissed = noReplyNeededAt && lastMessage && lastMessage.createdAt <= noReplyNeededAt;
  if (lastMessage?.author === "CONTACT" && !dismissed && !discarded && (human || now.getTime() - lastMessage.createdAt.getTime() > AI_GRACE_MS)) {
    return "waiting";
  }
  return human ? "human" : "ai";
}
