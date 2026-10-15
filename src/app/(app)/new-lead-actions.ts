"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { createLeadByHand } from "@/lib/domain/contact-import";
import { listFunnels } from "@/lib/domain/funnels";
import { DomainError } from "@/lib/domain/leads";

/** Opciones del formulario "Nuevo lead": se piden al abrirlo, no en cada página. */
export async function newLeadOptionsAction() {
  const user = await requireUser();
  const [funnels, executives] = await Promise.all([
    listFunnels(),
    user.role === "ADMIN" ? db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
  ]);
  return { funnels: funnels.map((f) => ({ id: f.id, name: f.name })), executives };
}

export type NewLeadState = { error: string } | { leadId: string; existing: boolean } | null;

export async function createLeadAction(_prev: NewLeadState, form: FormData): Promise<NewLeadState> {
  const user = await requireUser();
  const str = (k: string) => String(form.get(k) ?? "");
  const assignee = str("assigneeId");
  try {
    const result = await createLeadByHand(
      {
        name: str("name"),
        phone: str("phone"),
        email: str("email"),
        funnelId: str("funnelId") || null,
        // Un ejecutivo solo ve sus leads: el que crea queda a su nombre.
        assigneeId: user.role !== "ADMIN" ? user.id : assignee === "auto" ? undefined : assignee || null,
      },
      { actor: "USER", userId: user.id },
    );
    if (result.existing && user.role !== "ADMIN") {
      const lead = await db.lead.findUniqueOrThrow({ where: { id: result.leadId }, select: { assigneeId: true } });
      if (lead.assigneeId !== user.id) return { error: "Ese contacto ya tiene un lead abierto a cargo de otra persona." };
    }
    revalidatePath("/funnel");
    revalidatePath("/chats");
    return result;
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
}
