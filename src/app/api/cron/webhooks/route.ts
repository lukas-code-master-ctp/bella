import { NextResponse, type NextRequest } from "next/server";
import { deliverPendingWebhooks } from "@/lib/domain/webhooks";

export const dynamic = "force-dynamic";

/** Reintenta los webhooks que no salieron. Vercel Cron manda `Authorization: Bearer $CRON_SECRET`. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, ...(await deliverPendingWebhooks()) });
}
