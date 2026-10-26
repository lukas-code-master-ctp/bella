import { NextResponse } from "next/server";
import { issueSignedToken } from "@vercel/blob";
import { handleUploadPresigned, type HandleUploadPresignedBody } from "@vercel/blob/client";
import { currentUser } from "@/lib/auth";
import { currentCompanyId } from "@/lib/tenant";
import { EMAIL_IMAGE_MAX_BYTES, emailImageFolder } from "@/lib/file-limits";

export const dynamic = "force-dynamic";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

/**
 * Permiso para que el navegador de un admin suba una imagen de correo directo a Vercel Blob, en la
 * carpeta de su empresa. Queda pública (los correos la cargan desde ahí) y fuera de la biblioteca
 * de archivos que usa la IA.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Solo un admin puede subir imágenes." }, { status: 403 });
  const folder = emailImageFolder(await currentCompanyId());

  const body = (await request.json()) as HandleUploadPresignedBody;
  try {
    const result = await handleUploadPresigned({
      body,
      request,
      getSignedToken: async (pathname) => {
        if (!pathname.startsWith(`${folder}/`)) throw new Error("Carpeta no permitida.");
        const validUntil = Date.now() + 10 * 60 * 1000;
        return {
          token: await issueSignedToken({ pathname, operations: ["put"], maximumSizeInBytes: EMAIL_IMAGE_MAX_BYTES, allowedContentTypes: IMAGE_TYPES, validUntil }),
          urlOptions: { addRandomSuffix: true, maximumSizeInBytes: EMAIL_IMAGE_MAX_BYTES, allowedContentTypes: IMAGE_TYPES, validUntil },
        };
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[correo] permiso de subida de imagen:", err);
    return NextResponse.json({ error: "No se pudo preparar la subida." }, { status: 400 });
  }
}
