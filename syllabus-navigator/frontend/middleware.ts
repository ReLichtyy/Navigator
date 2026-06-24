import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"

// Public routes — everything else requires a signed-in Clerk user.
const isPublic = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/health(.*)",
  "/api/cron(.*)",
])

export default clerkMiddleware(async (auth, req) => {
  const traceId = crypto.randomUUID()
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set("x-trace-id", traceId)
  const next = () => NextResponse.next({ request: { headers: requestHeaders } })

  if (isPublic(req)) return next()

  const { userId } = await auth()
  if (!userId) {
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const signIn = new URL("/sign-in", req.url)
    signIn.searchParams.set("redirect_url", req.nextUrl.pathname)
    return NextResponse.redirect(signIn)
  }
  return next()
})

export const config = {
  matcher: [
    // Skip Next internals and static assets, run on everything else.
    "/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)",
    "/(api|trpc)(.*)",
  ],
}
