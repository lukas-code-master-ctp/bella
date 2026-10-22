"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { saveSlaSettings } from "@/lib/domain/sla";

const hour = (form: FormData, key: string, max: number) =>
  Math.min(max, Math.max(0, Math.round(Number(form.get(key)) || 0)));

const minutes = (form: FormData, key: string) => Math.round(Number(form.get(key)));

export async function saveSlaAction(_prev: string | null, form: FormData): Promise<string | null> {
  await requireAdmin();
  const firstMinutes = minutes(form, "firstMinutes");
  const replyMinutes = minutes(form, "replyMinutes");
  if (!(firstMinutes >= 1 && firstMinutes <= 10_080) || !(replyMinutes >= 1 && replyMinutes <= 10_080)) {
    return "Las metas deben ser de 1 minuto a 7 días (10.080 minutos).";
  }
  const reassign = form.get("reassign") === "on";
  const reassignMinutes = minutes(form, "reassignMinutes");
  if (!(reassignMinutes >= 1 && reassignMinutes <= 10_080)) return "El plazo de reasignación debe ser de 1 minuto a 7 días.";
  const hoursEnabled = form.get("hoursEnabled") === "on";
  const days = form.getAll("days").map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  if (hoursEnabled && !days.length) return "Elige al menos un día laboral.";
  await saveSlaSettings({
    firstMinutes,
    replyMinutes,
    alerts: form.get("alerts") === "on",
    escalate: form.get("escalate") === "on",
    reassign,
    reassignMinutes,
    hoursEnabled, days, from: hour(form, "from", 23), to: hour(form, "to", 24) });
  revalidatePath("/settings/sla");
  return "Guardado.";
}
