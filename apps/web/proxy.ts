import { NextResponse, type NextRequest } from "next/server";
import { readSession, SESSION_COOKIE } from "@/lib/auth";

/** Optimistic route guard: pages redirect to /login, APIs answer 401. Static assets are excluded by the matcher. */
export async function proxy(request: NextRequest) {
  const session = await readSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (session) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith("/api/") || pathname.startsWith("/_AMapService")) {
    return NextResponse.json({ error: "未登录或登录已过期" }, { status: 401 });
  }
  const url = new URL("/login", request.url);
  if (pathname !== "/") url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except the login page, Next internals and public files (anything with an extension).
  matcher: ["/((?!login|_next/|favicon.ico|.*\\.[a-zA-Z0-9]+$).*)"],
};
