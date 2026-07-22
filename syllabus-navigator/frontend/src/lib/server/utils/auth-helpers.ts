import { auth, currentUser } from "@clerk/nextjs/server"
import type { Role } from "@/lib/auth/rbac"
import { checkRateLimit } from "@/lib/rate-limit"
import { getOrCreateUserByClerk, getUserDisplayName } from "@/lib/server/repositories/user.repo"

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

function normalizePersonName(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/g, " ")
  return normalized ? normalized.slice(0, 200) : null
}

/**
 * Resolve the name stored with product feedback exclusively from the active
 * session/account. The request body is never allowed to provide this field.
 */
export async function requireProductFeedbackIdentity(): Promise<{
  userId: string
  role: Role
  personName: string
}> {
  const authed = await requireAuth()
  let clerkName: string | null = null

  try {
    const profile = await currentUser()
    clerkName =
      normalizePersonName(profile?.fullName) ??
      normalizePersonName(profile?.firstName) ??
      normalizePersonName(profile?.primaryEmailAddress?.emailAddress)
  } catch {
    // The stable local profile remains available if Clerk profile hydration fails.
  }

  const localName = clerkName ? null : normalizePersonName(await getUserDisplayName(authed.userId))
  return {
    ...authed,
    personName: clerkName ?? localName ?? "Usuario",
  }
}

/** Dedicated low-volume limit so feedback cannot become a write-abuse path. */
export async function requireProductFeedbackRateLimit(userId: string): Promise<void> {
  const rl = await checkRateLimit(userId, "product-feedback")
  if (!rl.success) {
    const retryAfter = Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000))
    throw new ApiErrorResponse(
      `Has enviado demasiados comentarios. Inténtalo de nuevo en ${retryAfter}s.`,
      429,
    )
  }
}
