import { z } from "zod";
import { formatChileDateTime } from "../domain/follow-ups";
import { completeOnce, jsonIn } from "./complete";
import type { ProviderClients } from "./providers";

/**
 * Resumen de una llamada grabada (ver src/lib/domain/call-recordings.ts): qué quería el cliente,
 * qué se acordó, el próximo paso y las tareas que salen de lo acordado, para que el ejecutivo las
 * cree con un clic.
 */

const Summary = z.object({
  resumen: z.string().min(1),
  proximoPaso: z.string().default(""),
  tareas: z.array(z.object({ titulo: z.string().min(1), fecha: z.string().nullish() })).default([]),
});

export type CallSummary = { summary: string; nextStep: string; tasks: { title: string; due: string | null }[] };

/** Cuántas tareas puede proponer como máximo. */
export const MAX_PROPOSED_TASKS = 3;

function prompt(companyName: string) {
  return [
    `Resumes llamadas de WhatsApp entre ejecutivos de ${companyName} y sus clientes. Recibes la transcripción y ` +
      "respondes solo con un objeto JSON, sin texto adicional:",
    '{"resumen": string, "proximoPaso": string, "tareas": [{"titulo": string, "fecha": string | null}]}',
    "",
    "- Todo en español de Chile, concreto y breve.",
    "- resumen: 2 a 4 frases con qué quería el cliente, lo importante que dijo (presupuesto, plazos, dudas, " +
      "objeciones) y qué se acordó. Sin saludos ni relleno.",
    "- proximoPaso: una frase con lo que sigue (ej. \"Enviar cotización del lote 12 por WhatsApp\"); vacío si no quedó nada.",
    `- tareas: solo compromisos concretos del ejecutivo o la empresa (llamar de nuevo, enviar algo, agendar una ` +
      `visita), máximo ${MAX_PROPOSED_TASKS}. titulo en imperativo, máximo 80 caracteres (ej. "Llamar para confirmar ` +
      'la visita"). fecha en formato "AAAA-MM-DD HH:MM" (hora de Chile) si se acordó un día u hora, o null si no. ' +
      "Si no hubo compromisos, una lista vacía.",
    "- Basa todo en la transcripción; no inventes datos. Si la llamada no tuvo contenido (no se escucha nada, " +
      "número equivocado), dilo en el resumen y no propongas tareas.",
  ].join("\n");
}

export function parseCallSummary(text: string): CallSummary | null {
  const parsed = Summary.safeParse(jsonIn(text));
  if (!parsed.success) return null;
  const one = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);
  return {
    summary: one(parsed.data.resumen, 1000),
    nextStep: one(parsed.data.proximoPaso, 300),
    tasks: parsed.data.tareas
      .map((t) => ({ title: one(t.titulo, 200), due: t.fecha?.trim() || null }))
      .filter((t) => t.title)
      .slice(0, MAX_PROPOSED_TASKS),
  };
}

export async function summarizeCall(
  {
    transcript,
    companyName,
    contactName,
    userName,
    at,
    clients = {},
  }: { transcript: string; companyName: string; contactName: string; userName: string | null; at: Date; clients?: ProviderClients },
): Promise<CallSummary> {
  const input = [
    `Llamada del ${formatChileDateTime(at)} (hora de Chile) con ${contactName}${userName ? `; atendió ${userName}` : ""}.`,
    "",
    "<transcripcion>",
    transcript,
    "</transcripcion>",
  ].join("\n");
  const { text } = await completeOnce({ system: prompt(companyName), input, maxTokens: 1500, clients });
  const result = parseCallSummary(text);
  if (!result) throw new Error(`El resumen no vino en JSON válido: ${text.slice(0, 200)}`);
  return result;
}
