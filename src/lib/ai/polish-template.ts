import { DomainError } from "../domain/leads";
import { getAssistantSettings } from "../settings";
import { completeOnce } from "./complete";
import type { ProviderClients } from "./providers";

/*
 * Botón "Pulir" de Nueva plantilla: la IA mejora la redacción del mensaje que escribió el admin.
 * Es un borrador que vuelve al campo de texto; no se manda a Meta hasta que lo confirmen.
 */

function polishPrompt(companyName: string, category: string) {
  return [
    `Mejoras la redacción de una plantilla de WhatsApp que ${companyName} enviará a sus clientes ` +
      `(${category === "UTILITY" ? "un aviso: recordatorio o confirmación" : "marketing: promoción o novedad"}).`,
    "",
    "Reglas:",
    "- Mantén la intención, los datos y el idioma del texto original. No inventes precios, fechas, " +
      "descuentos ni datos que no estén.",
    "- Hazlo claro, cercano y breve, con buena ortografía y puntuación. Puedes usar algún emoji si calza.",
    "- Las variables {{1}}, {{2}}… se reemplazan por datos de cada persona ({{1}} suele ser el nombre). " +
      "Conserva exactamente las mismas variables, cada una una vez, sin agregar ni quitar, y con un sentido " +
      "parecido en la frase.",
    "- El mensaje no puede empezar ni terminar con una variable y tiene máximo 1024 caracteres.",
    "- Si es marketing, cierra invitando a responder (WhatsApp sigue la conversación por chat).",
    "- Devuelve solo el texto final de la plantilla: sin comillas, sin markdown, sin explicaciones.",
  ].join("\n");
}

const vars = (text: string) =>
  [...text.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)]
    .map((m) => m[1])
    .sort()
    .join(",");

const clean = (text: string) => text.trim().replace(/^["“«]+|["”»]+$/g, "").trim();

/** Devuelve el texto pulido, con las mismas variables; si la IA las cambia, reintenta una vez. */
export async function polishTemplateText(
  text: string,
  category: "MARKETING" | "UTILITY",
  { clients = {} }: { clients?: ProviderClients } = {},
): Promise<string> {
  const original = text.trim();
  if ((original.replace(/\{\{[^}]*\}\}/g, " ").match(/\p{L}+/gu) ?? []).length < 3) throw new DomainError("Escribe primero la idea del mensaje y luego púlelo.");
  const { companyName } = await getAssistantSettings();
  const system = polishPrompt(companyName, category);
  for (let attempt = 0; attempt < 2; attempt++) {
    const { text: reply } = await completeOnce({ system, input: original, maxTokens: 1500, effort: "low", clients });
    const polished = clean(reply);
    const ok = polished && polished.length <= 1024 && vars(polished) === vars(original) && !/^\{\{|\}\}$/.test(polished);
    if (ok) return polished;
  }
  throw new DomainError("La IA no logró pulirlo respetando las variables. Intenta de nuevo o ajústalo a mano.");
}
