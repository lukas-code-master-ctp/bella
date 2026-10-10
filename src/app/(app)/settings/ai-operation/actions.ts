"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { answerWaitingLeads } from "@/lib/ai/respond";
import { saveAiOperation } from "@/lib/domain/ai-operation";

const hour = (form: FormData, key: string, max: number) =>
  Math.min(max, Math.max(0, Math.round(Number(form.get(key)) || 0)));

/** Apagado general de la IA. Al encenderla, responde lo que quedó pendiente mientras estuvo apagada. */
export async function setAiPausedAction(paused: boolean) {
  await requireAdmin();
  await saveAiOperation({ paused });
  if (!paused) after(() => answerWaitingLeads().catch((err) => console.error("[ia] pendientes al encender:", err)));
  revalidatePath("/settings/ai-operation");
}

export async function saveAiOperationAction(_prev: string | null, form: FormData): Promise<string | null> {
  await requireAdmin();
  const hoursEnabled = form.get("hoursEnabled") === "on";
  const days = form.getAll("days").map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  const outOfHoursMessage = String(form.get("outOfHoursMessage") ?? "").trim();
  const outOfHours = form.get("outOfHours") === "silent" ? "silent" : "message";
  if (hoursEnabled && !days.length) return "Elige al menos un día de atención.";
  if (hoursEnabled && outOfHours === "message" && !outOfHoursMessage) return "Escribe el mensaje fuera de horario.";
  await saveAiOperation({
    hoursEnabled,
    days,
    from: hour(form, "from", 23),
    to: hour(form, "to", 24),
    outOfHours,
    ...(outOfHoursMessage ? { outOfHoursMessage } : {}),
    previousTickets: form.get("previousTickets") === "on",
  });
  revalidatePath("/settings/ai-operation");
  return "Guardado.";
}
