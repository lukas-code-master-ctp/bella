"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { enterCompany, requireSuperadmin } from "@/lib/auth";
import { companyName, createCompany } from "@/lib/domain/companies";

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

export async function createCompanyAction(_prev: string | null, form: FormData): Promise<string | null> {
  await requireSuperadmin();
  const result = await createCompany({
    name: str(form, "name"),
    adminName: str(form, "adminName"),
    adminEmail: str(form, "adminEmail"),
    adminPassword: String(form.get("adminPassword") ?? ""),
  });
  if ("error" in result) return result.error;
  revalidatePath("/settings/companies");
  return null;
}

/** Entra a la empresa: todo lo que ve y hace desde ahora es de ella, hasta volver a cambiar. */
export async function enterCompanyAction(companyId: string) {
  const user = await requireSuperadmin();
  if (!(await companyName(companyId))) throw new Error("La empresa no existe.");
  await enterCompany(user, companyId);
  redirect("/funnel");
}
