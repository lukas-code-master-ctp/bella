import { cronRoute } from "@/lib/cron";
import { answerWaitingLeads } from "@/lib/ai/respond";

export const dynamic = "force-dynamic";
// Cada respuesta es una llamada a la IA.
export const maxDuration = 300;

/**
 * Responde lo que los clientes escribieron fuera del horario de atención o con la IA apagada.
 */
export const GET = cronRoute(async () => ({ answered: await answerWaitingLeads() }));
