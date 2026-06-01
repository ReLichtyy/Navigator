import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { getToken } from "next-auth/jwt"

// Routes that don't require authentication
const PUBLIC_PATHS = [
  "/",
  "/login",
  "/signup",
  "/api/auth",
  "/api/health",
  "/api/cron",
]

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.includes(pathname) || PUBLIC_PATHS.some((p) => p !== "/" && pathname.startsWith(p))
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // 1. Allow static files and Next.js internals
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return NextResponse.next()
  }

  // 2. Pure Edge-safe traceability
  const traceId = crypto.randomUUID()
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set("x-trace-id", traceId)
  
  const response = NextResponse.next({ request: { headers: requestHeaders } })

  // 3. Allow public routes
  if (isPublic(pathname)) {
    return response
  }

  // 4. Check authentication using getToken
  const token = await getToken({ req, secret: process.env.AUTH_SECRET })

  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const loginUrl = new URL("/login", req.url)
    loginUrl.searchParams.set("callbackUrl", pathname)
    return NextResponse.redirect(loginUrl)
  }

  // 5. Check guest restrictions for private paths
  const isGuest = token.role === "guest"
  const isPrivate = pathname.startsWith("/settings") || 
                    pathname.startsWith("/api/user/preferences") ||
                    pathname.startsWith("/api/usage")

  if (isGuest && isPrivate) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Forbidden for guests" }, { status: 403 })
    }
    const homeUrl = new URL("/", req.url)
    return NextResponse.redirect(homeUrl)
  }

  return response
}

export const config = {
  // Run middleware on all routes except static assets
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
}
