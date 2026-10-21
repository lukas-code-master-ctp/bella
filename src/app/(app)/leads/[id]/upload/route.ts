import { NextResponse } from "next/server";
import { issueSignedToken } from "@vercel/blob";
import { handleUploadPresigned, type HandleUploadPresignedBody } from "@vercel/blob/client";
import { canAccessLead, currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { leadUploadFolder, UPLOAD_MAX_BYTES } from "@/lib/file-limits";

export const dynamic = "force-dynamic";

/**
 * Permiso para que el navegador del ejecutivo suba un archivo directo a Vercel Blob. Así no pasa
 * por el servidor, que no acepta cuerpos de más de 4,5 MB, y se llega al tope de WhatsApp. El
 * permiso vale solo para la carpeta de este lead y dura unos minutos.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Inicia sesión de nuevo." }, { status: 401 });
  const { id } = await params;
  const lead = await db.lead.findUnique({ where: { id }, select: { assigneeId: true } });
  if (!lead || !canAccessLead(user, lead)) return NextResponse.json({ error: "Sin acceso a este lead." }, { status: 403 });

  const body = (await request.json()) as HandleUploadPresignedBody;
  try {
    const result = await handleUploadPresigned({
      body,
      request,
      getSignedToken: async (pathname) => {
        if (!pathname.startsWith(`${leadUploadFolder(id)}/`)) throw new Error("Carpeta no permitida.");
        const validUntil = Date.now() + 10 * 60 * 1000;
        return {
          token: await issueSignedToken({ pathname, operations: ["put"], maximumSizeInBytes: UPLOAD_MAX_BYTES, validUntil }),
          urlOptions: { addRandomSuffix: true, maximumSizeInBytes: UPLOAD_MAX_BYTES, validUntil },
        };
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error(`[archivos] permiso de subida del lead ${id}:`, err);
    return NextResponse.json({ error: "No se pudo preparar la subida." }, { status: 400 });
  }
}
