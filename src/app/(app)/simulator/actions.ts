"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { createLead } from "@/lib/domain/leads";

export async function createSimulatedLeadAction(form: FormData) {
  const user = await requireUser();
  const name = String(form.get("name") ?? "").trim() || "Cliente de prueba";
  const lead = await createLead({ name, channel: "SIMULATOR" }, { funnelId: String(form.get("funnelId") ?? "") || null });
  // Un ejecutivo debe poder ver el lead que acaba de crear para probar.
  if (user.role === "EXECUTIVE") {
    const current = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    if (!current.assigneeId) await db.lead.update({ where: { id: lead.id }, data: { assigneeId: user.id } });
  }
  redirect(`/leads/${lead.id}`);
}
