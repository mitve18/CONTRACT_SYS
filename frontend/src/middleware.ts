// Password gate. Open only in local development when APP_PASSWORD is not set;
// in production a missing password locks the app instead of exposing it.
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, sessionToken } from "@/lib/session";

export async function middleware(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) {
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    return new NextResponse("APP_PASSWORD is not configured. Set it in the hosting environment.", { status: 503 });
  }

  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/login") || pathname.startsWith("/auth")) return NextResponse.next();

  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (cookie && cookie === (await sessionToken(password))) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ detail: "נדרשת התחברות" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Only these named public files skip the gate (the login screen needs the emblem and icons).
  matcher: ["/((?!_next/static|_next/image|emblem\\.png$|icon\\.png$|apple-icon\\.png$|favicon\\.ico$).*)"],
};
