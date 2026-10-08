import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session-token";

export async function middleware(request: NextRequest) {
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
  matcher: ["/((?!login|api/webhooks|_next/static|_next/image|favicon.ico).*)"],
};
