"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { pauseAlertCampaign, refreshCampaignAdvice, runCampaignAlerts, saveCampaignAlertSettings } from "@/lib/domain/campaign-alerts";

const PATH = "/metrics/campaigns";

export async function saveCampaignAlertsAction(form: FormData) {
  await requireAdmin();
  await saveCampaignAlertSettings({
    enabled: form.get("enabled") === "on",
    minLeads: Number(form.get("minLeads")),
    lostPct: Number(form.get("lostPct")),
    days: Number(form.get("days")),
    allowPause: form.get("allowPause") === "on",
  });
  revalidatePath(PATH);
}

/** Revisa las campañas ahora, sin esperar al cron. */
export async function checkCampaignsAction(): Promise<string | null> {
  await requireAdmin();
  const result = await runCampaignAlerts();
  revalidatePath(PATH);
  revalidatePath("/metrics");
  if (!result.enabled) return "La revisión de campañas está apagada.";
  return null;
}

export async function refreshAdviceAction(alertId: string): Promise<string | null> {
  await requireAdmin();
  try {
    await refreshCampaignAdvice(alertId);
  } catch (e) {
    console.error("[alertas de campaña]", e);
    return "La IA no pudo generar la recomendación. Revisa la configuración de la IA e inténtalo de nuevo.";
  }
  revalidatePath(PATH);
  return null;
}

export async function pauseCampaignAction(alertId: string): Promise<string | null> {
  const user = await requireAdmin();
  const error = await pauseAlertCampaign(alertId, user.id);
  revalidatePath(PATH);
  return error;
}
