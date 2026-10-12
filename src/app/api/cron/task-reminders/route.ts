import { cronRoute } from "@/lib/cron";
import { sendTaskReminders } from "@/lib/domain/tasks";

export const dynamic = "force-dynamic";

export const GET = cronRoute(sendTaskReminders);
