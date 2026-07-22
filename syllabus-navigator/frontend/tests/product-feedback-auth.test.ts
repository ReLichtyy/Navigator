import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
  currentUser: vi.fn(),
}))
vi.mock("@/lib/server/repositories/user.repo", () => ({
  getOrCreateUserByClerk: vi.fn(),
  getUserDisplayName: vi.fn(),
}))
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }))

import { auth, currentUser } from "@clerk/nextjs/server"
import { checkRateLimit } from "@/lib/rate-limit"
import { getOrCreateUserByClerk, getUserDisplayName } from "@/lib/server/repositories/user.repo"
import {
  requireProductFeedbackIdentity,
  requireProductFeedbackRateLimit,
} from "@/lib/server/utils/auth-helpers"

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(auth).mockResolvedValue({ userId: "clerk-user" } as Awaited<ReturnType<typeof auth>>)
  vi.mocked(getOrCreateUserByClerk).mockResolvedValue({
    id: "b7cb2c79-8f64-44d4-a1d1-af669d8099f8",
    role: "free",
  })
  vi.mocked(currentUser).mockResolvedValue({
    fullName: "Ada Lovelace",
    firstName: "Ada",
    primaryEmailAddress: { emailAddress: "ada@example.com" },
  } as Awaited<ReturnType<typeof currentUser>>)
  vi.mocked(getUserDisplayName).mockResolvedValue("Nombre local")
  vi.mocked(checkRateLimit).mockResolvedValue({
    success: true,
    limit: 5,
    remaining: 4,
    reset: Date.now() + 60_000,
  })
})

describe("product feedback request identity", () => {
  it("takes the visible person's name from the active Clerk session", async () => {
    const identity = await requireProductFeedbackIdentity()
    expect(identity).toEqual({
      userId: "b7cb2c79-8f64-44d4-a1d1-af669d8099f8",
      role: "free",
      personName: "Ada Lovelace",
    })
  })

  it("falls back to the local profile when Clerk has no usable name or email", async () => {
    vi.mocked(currentUser).mockResolvedValue({
      fullName: null,
      firstName: null,
      primaryEmailAddress: null,
    } as Awaited<ReturnType<typeof currentUser>>)

    expect((await requireProductFeedbackIdentity()).personName).toBe("Nombre local")
  })

  it("uses the dedicated five-per-minute feedback limit", async () => {
    await requireProductFeedbackRateLimit("b7cb2c79-8f64-44d4-a1d1-af669d8099f8")
    expect(checkRateLimit).toHaveBeenCalledWith(
      "b7cb2c79-8f64-44d4-a1d1-af669d8099f8",
      "product-feedback",
    )
  })
})
