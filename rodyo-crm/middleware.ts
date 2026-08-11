import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COOKIE_NAME = "rodyo_auth";

// Gate is a no-op until SITE_ACCESS_TOKEN is actually set (e.g. locally, or
// before it's configured in Vercel) — never lock everyone out by accident.
export function middleware(request: NextRequest) {
  const expected = process.env.SITE_ACCESS_TOKEN;
  if (!expected) {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (token === expected) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Only gates page navigation — API routes stay open so the cron-triggered
  // syncs (vercel.json) keep working without a session cookie.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|login).*)"]
};
