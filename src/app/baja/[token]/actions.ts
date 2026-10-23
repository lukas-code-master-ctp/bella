"use server";

import { revalidatePath } from "next/cache";
import { publicCompanyId } from "@/lib/company-request";
import { readUnsubscribeToken, resubscribeEmail, suppressEmail } from "@/lib/domain/email-suppression";
import { withCompany } from "@/lib/tenant";

async function fromToken(token: string) {
  const data = readUnsubscribeToken(token);
  const companyId = data && (await publicCompanyId(data.companyId));
  return data && companyId ? { companyId, email: data.email } : null;
}

export async function unsubscribeAction(form: FormData) {
  const token = String(form.get("token") ?? "");
  const data = await fromToken(token);
  if (!data) return;
  await withCompany(data.companyId, () => suppressEmail(data.email, "UNSUBSCRIBED"));
  revalidatePath(`/baja/${token}`);
}

export async function resubscribeAction(form: FormData) {
  const token = String(form.get("token") ?? "");
  const data = await fromToken(token);
  if (!data) return;
  await withCompany(data.companyId, () => resubscribeEmail(data.email));
  revalidatePath(`/baja/${token}`);
}
