import { NextResponse } from "next/server";
import { issueSignedToken } from "@vercel/blob";
import { handleUploadPresigned, type HandleUploadPresignedBody } from "@vercel/blob/client";
import { currentUser } from "@/lib/auth";
import { canUploadRecording, recordingFolder, RECORDING_MAX_BYTES } from "@/lib/domain/call-recordings";

export const dynamic = "force-dynamic";

/**
 * Permiso para que el navegador de quien atendió una llamada suba su grabación directo a Vercel
 * Blob (no pasa por el servidor, que no acepta cuerpos de más de 4,5 MB). Vale solo para la
 * carpeta de esa llamada, una vez, y dura unos minutos.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Inicia sesión de nuevo." }, { status: 401 });
  const { id } = await params;
  if (!(await canUploadRecording(id, user.id))) return NextResponse.json({ error: "Sin acceso a esta llamada." }, { status: 403 });

  const body = (await request.json()) as HandleUploadPresignedBody;
  try {
    const result = await handleUploadPresigned({
      body,
      request,
      getSignedToken: async (pathname) => {
        if (!pathname.startsWith(`${recordingFolder(id)}/`)) throw new Error("Carpeta no permitida.");
        const validUntil = Date.now() + 10 * 60 * 1000;
        return {
          token: await issueSignedToken({ pathname, operations: ["put"], maximumSizeInBytes: RECORDING_MAX_BYTES, validUntil }),
          urlOptions: { addRandomSuffix: true, maximumSizeInBytes: RECORDING_MAX_BYTES, validUntil },
        };
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error(`[llamadas] permiso de subida de la grabación ${id}:`, err);
    return NextResponse.json({ error: "No se pudo preparar la subida." }, { status: 400 });
  }
}
