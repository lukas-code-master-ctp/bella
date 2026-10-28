import { cronRoute } from "@/lib/cron";
import { resumeStuckAnalyses } from "@/lib/domain/call-recordings";

export const dynamic = "force-dynamic";
// Cada análisis transcribe y resume una llamada con la IA.
export const maxDuration = 300;

/** Retoma la transcripción y el resumen de las llamadas grabadas que quedaron a medias. */
export const GET = cronRoute(async () => ({ resumed: await resumeStuckAnalyses() }));
