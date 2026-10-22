"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { enterCompany, requireSuperadmin } from "@/lib/auth";
import { companyStatus, createCompany, deleteCompany, reactivateCompany, suspendCompany } from "@/lib/domain/companies";
import { currentCompanyId } from "@/lib/tenant";

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

export async function createCompanyAction(_prev: string | null, form: FormData): Promise<string | null> {
  const user = await requireSuperadmin();
  const result = await createCompany(
    { name: str(form, "name"), adminName: str(form, "adminName"), adminEmail: str(form, "adminEmail") },
    user,
  );
  if ("error" in result) return result.error;
  revalidatePath("/settings/companies");
  return result.emailed
    ? null
    : "Empresa creada, pero no se pudo mandar el correo al administrador. Entra a la empresa y reenvíalo desde Usuarios.";
}

/** Entra a la empresa: todo lo que ve y hace desde ahora es de ella, hasta volver a cambiar. */
export async function enterCompanyAction(companyId: string) {
  const user = await requireSuperadmin();
  const status = await companyStatus(companyId);
  if (!status || status === "deleted") throw new Error("La empresa no existe.");
  await enterCompany(user, companyId);
  redirect("/funnel");
}

export async function suspendCompanyAction(companyId: string): Promise<string | null> {
  const user = await requireSuperadmin();
  const error = await suspendCompany(user, companyId);
  revalidatePath("/settings/companies");
  return error;
}

export async function reactivateCompanyAction(companyId: string): Promise<string | null> {
  await requireSuperadmin();
  const error = await reactivateCompany(companyId);
  revalidatePath("/settings/companies");
  return error;
}

export async function deleteCompanyAction(companyId: string, _prev: string | null, form: FormData): Promise<string | null> {
  const user = await requireSuperadmin();
  const error = await deleteCompany(user, companyId, str(form, "confirmName"), await currentCompanyId());
  if (!error) revalidatePath("/settings/companies");
  return error;
}
