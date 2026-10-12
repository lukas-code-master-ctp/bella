import { cronRoute } from "@/lib/cron";
import { runDueFollowUps } from "@/lib/ai/follow-ups";

export const dynamic = "force-dynamic";
// Cada seguimiento es una llamada a la IA.
export const maxDuration = 300;

export const GET = cronRoute(runDueFollowUps);
