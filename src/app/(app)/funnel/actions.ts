"use server";

import { revalidatePath } from "next/cache";
import { canAccessLead, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { moveStage } from "@/lib/domain/leads";

export async function moveLeadAction(leadId: string, stageId: string) {
  const user = await requireUser();
  const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId } });
  if (!canAccessLead(user, lead)) throw new Error("Sin acceso a este lead.");
  await moveStage(leadId, stageId, { actor: "USER", userId: user.id });
  revalidatePath("/funnel");
}
