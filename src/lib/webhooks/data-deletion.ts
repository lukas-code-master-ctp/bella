import { NextResponse, type NextRequest } from "next/server";
import { credential } from "@/lib/credentials";
import { companyUrls, withParams } from "@/lib/company-urls";
import { currentCompanyId } from "@/lib/tenant";
import { pageScopedIds } from "@/lib/channels/messenger";
import { deleteMetaUserData, parseSignedRequest } from "@/lib/domain/privacy";

/**
 * Callback de eliminación de datos de Meta: cuando una persona quita la app o pide borrar sus
 * datos, Meta llama aquí con un `signed_request`. Se borra lo encontrado (o queda pendiente de
 * revisión) y se responde con la URL y el código para que la persona consulte el estado.
 */
export async function requestDataDeletion(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  const signed = String(form?.get("signed_request") ?? "");
  const data = parseSignedRequest(signed, await credential("META_APP_SECRET"));
  if (!data?.user_id) return NextResponse.json({ error: "signed_request inválido" }, { status: 400 });
  const { code } = await deleteMetaUserData(data.user_id, await pageScopedIds(data.user_id));
  const page = companyUrls(request.nextUrl.origin, await currentCompanyId()).dataDeletion;
  const url = withParams(page, `codigo=${code}`);
  return NextResponse.json({ url, confirmation_code: code });
}
