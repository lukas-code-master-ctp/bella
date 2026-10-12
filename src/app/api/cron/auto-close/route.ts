import { cronRoute } from "@/lib/cron";
import { runAutoClose } from "@/lib/domain/auto-close";

export const dynamic = "force-dynamic";

export const GET = cronRoute(async () => ({ closed: await runAutoClose() }));
