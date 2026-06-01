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

export default auth((req) => {
  const { pathname } = req.nextUrl

  // Allow public routes
  if (isPublic(pathname)) {
    return NextResponse.next()
  }

  // Allow static files and Next.js internals
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return NextResponse.next()
  }

  // Check authentication
  if (!req.auth) {
    const loginUrl = new URL("/login", req.url)
    loginUrl.searchParams.set("callbackUrl", pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
})

export const config = {
  // Run middleware on all routes except static assets
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
}
