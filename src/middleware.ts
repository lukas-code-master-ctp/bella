import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session-token";

export async function middleware(request: NextRequest) {
  // Enlace público que las landings usan para abrir WhatsApp con sus UTM.
  if (request.nextUrl.pathname === "/wa") return NextResponse.next();
  const userId = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!userId) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|privacidad|eliminacion-de-datos|api/webhooks|api/cron|_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest).*)"],
};
