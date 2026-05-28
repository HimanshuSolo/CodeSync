import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

// routes that don't need auth
const PUBLIC_ROUTES = ["/login", "/register"]

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // allow public routes through
  if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    return NextResponse.next()
  }

  // check for token in cookies
  // (set by login/register — we'll add cookie setting in Phase 12)
  const token = request.cookies.get("codesync_token")?.value

  // no token — redirect to login
  if (!token) {
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("from", pathname)
    // NOTE: currently commented out so you can
    // browse the UI without being logged in
    // Uncomment when backend is ready in Phase 12:
    // return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  // run on all routes except static files and api routes
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
}