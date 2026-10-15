"use server";

import { requireUser } from "@/lib/auth";
import { searchLeads } from "@/lib/domain/search";

/** Búsqueda global (⌘K): un ejecutivo solo encuentra sus leads, igual que en el funnel. */
export async function searchLeadsAction(query: string) {
  const user = await requireUser();
  return searchLeads(query.slice(0, 100), user.role === "ADMIN" ? {} : { assigneeId: user.id });
}
