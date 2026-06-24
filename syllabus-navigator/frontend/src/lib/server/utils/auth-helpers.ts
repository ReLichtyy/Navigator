import { auth, currentUser } from "@clerk/nextjs/server"
import type { Role } from "@/lib/auth/rbac"
import { checkRateLimit } from "@/lib/rate-limit"
import { getOrCreateUserByClerk } from "@/lib/server/repositories/user.repo"

export class ApiErrorResponse extends Error {
  constructor(
    public message: string,
    public status: number,
  ) {
    super(message)
    this.name = "ApiErrorResponse"
  }
}

/**
 * Resolve the caller's Neon user row from Clerk, or null if unauthenticated.
 * Returns our stable UUID (`userId`) + role so downstream services/repos stay
 * unchanged — they never see Clerk ids. Non-throwing variant for routes that
 * shape their own 401 inside a try/catch.
 */
export async function getAuthedUser(): Promise<{ userId: string; role: Role } | null> {
  const { userId: clerkId } = await auth()
  if (!clerkId) return null
  const user = await getOrCreateUserByClerk(clerkId, async () => {
    const cu = await currentUser()
    return {
      email: cu?.primaryEmailAddress?.emailAddress ?? null,
      name: cu?.fullName ?? cu?.firstName ?? null,
      image: cu?.imageUrl ?? null,
    }
  })
  return { userId: user.id, role: (user.role ?? "free") as Role }
}

/**
 * Gate a request behind Clerk auth; throws ApiErrorResponse(401) when signed out.
 */
export async function requireAuth() {
  const authed = await getAuthedUser()
  if (!authed) throw new ApiErrorResponse("Unauthorized", 401)
  return authed
}

export async function requireRateLimit(userId: string, role: Role) {
  const rl = await checkRateLimit(userId, role === "guest" ? "guest" : "authenticated")
  if (!rl.success) {
    const retryAfter = Math.ceil((rl.reset - Date.now()) / 1000).toString()
    throw new ApiErrorResponse(
      `Rate limit exceeded. Please wait before sending more messages. Retry after ${retryAfter}s`,
      429,
    )
  }
}
