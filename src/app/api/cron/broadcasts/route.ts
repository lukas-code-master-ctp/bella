import type { NextRequest } from "next/server";
import { cronRoute } from "@/lib/cron";
import { RUN_BUDGET_MS, runBroadcasts } from "@/lib/domain/broadcasts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Las empresas se recorren una tras otra: el tiempo de la corrida es para todas juntas.
export function GET(request: NextRequest) {
  const deadline = Date.now() + RUN_BUDGET_MS;
  return cronRoute(() => runBroadcasts({ deadline }))(request);
}
