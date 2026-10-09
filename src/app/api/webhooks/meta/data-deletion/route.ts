import { NextResponse, type NextRequest } from "next/server";
import { deleteMetaUserData, parseSignedRequest } from "@/lib/domain/privacy";

export const dynamic = "force-dynamic";

/**
 * Callback de eliminación de datos de Meta: cuando una persona quita la app o pide borrar sus
 * datos, Meta llama aquí con un `signed_request`. Se borra todo y se responde con la URL y el
 * código para que la persona consulte el estado.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  const signed = String(form?.get("signed_request") ?? "");
  const data = parseSignedRequest(signed, process.env.META_APP_SECRET);
  if (!data?.user_id) return NextResponse.json({ error: "signed_request inválido" }, { status: 400 });
  const { code } = await deleteMetaUserData(data.user_id);
  const url = new URL(`/eliminacion-de-datos?codigo=${code}`, request.nextUrl.origin).toString();
  return NextResponse.json({ url, confirmation_code: code });
}
