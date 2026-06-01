import { auth } from "@/lib/auth/auth"
import type { Role } from "@/lib/auth/rbac"
import { checkRateLimit } from "@/lib/rate-limit"

export class ApiErrorResponse extends Error {
  constructor(public message: string, public status: number) {
    super(message)
    this.name = "ApiErrorResponse"
  }
}

export async function requireAuth() {
  const session = await auth()
  if (!session?.user?.id) {
    throw new ApiErrorResponse("Unauthorized", 401)
  }
  return {
    userId: session.user.id,
    role: (session.user.role ?? "free") as Role,
  }
}

export async function requireRateLimit(userId: string, role: Role) {
  const rl = await checkRateLimit(userId, role === "guest" ? "guest" : "authenticated")
  if (!rl.success) {
    const retryAfter = Math.ceil((rl.reset - Date.now()) / 1000).toString()
    throw new ApiErrorResponse(`Rate limit exceeded. Please wait before sending more messages. Retry after ${retryAfter}s`, 429)
  }
}
