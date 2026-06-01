/**
 * middleware.ts — Edge middleware for auth protection and rate limiting.
 *
 * Runs on every request before route handlers.
 * - Redirects unauthenticated users to /login (except public routes).
 * - Sets trace ID header for observability.
 */

import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { auth } from "@/lib/auth/config"
import { checkRateLimit, isRateLimitEnabled } from "@/lib/rate-limit"
import { startTrace } from "@/lib/observability/trace"

// Routes that don't require authentication
const PUBLIC_PATHS = [
  "/login",
  "/signup",
  "/api/auth",
  "/api/health",
]

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname.startsWith(p))
}

export default auth(async (req) => {
  const { pathname } = req.nextUrl

  // Allow static files and Next.js internals
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return NextResponse.next()
  }

  // Set trace ID for observability
  const traceId = startTrace()

  // Rate Limiting (apply to all non-static paths, public or not)
  if (isRateLimitEnabled()) {
    const identifier = req.auth?.user?.id ?? req.ip ?? "anonymous"
    const tier = req.auth?.user?.role ?? "free"
    
    const rl = await checkRateLimit(identifier, tier)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too Many Requests", traceId },
        { 
          status: 429, 
          headers: { "Retry-After": String(Math.ceil((rl.retryAfterMs ?? 60000) / 1000)) } 
        }
      )
    }
  }

  // Allow public routes
  if (isPublic(pathname)) {
    const requestHeaders = new Headers(req.headers)
    requestHeaders.set("x-trace-id", traceId)
    return NextResponse.next({ request: { headers: requestHeaders } })
  }

  // Check authentication
  if (!req.auth) {
    const loginUrl = new URL("/login", req.url)
    loginUrl.searchParams.set("callbackUrl", pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Check guest restrictions for private paths
  const isGuest = req.auth.user.role === "guest"
  const isPrivate = pathname.startsWith("/settings") || 
                    pathname.startsWith("/api/user/preferences") ||
                    pathname.startsWith("/api/usage")

  if (isGuest && isPrivate) {
    // Redirect guests trying to access settings to the home page
    const homeUrl = new URL("/", req.url)
    return NextResponse.redirect(homeUrl)
  }

  const requestHeaders = new Headers(req.headers)
  requestHeaders.set("x-trace-id", traceId)
  return NextResponse.next({ request: { headers: requestHeaders } })
})

export const config = {
  // Run middleware on all routes except static assets
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
}
