import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/lib/auth/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }))
vi.mock("@/lib/metering", () => ({ getUserUsage: vi.fn() }))
// cached(key, ttl, fn) → just run the producer
vi.mock("@/lib/cache", () => ({ cached: (_k: string, _t: number, fn: () => unknown) => fn() }))

import { auth } from "@/lib/auth/auth"
import { getUserUsage } from "@/lib/metering"
import { GET } from "../app/api/usage/route"

const asUser = (id = "u1") => vi.mocked(auth).mockResolvedValue({ user: { id, role: "free" } } as any)
const anon = () => vi.mocked(auth).mockResolvedValue(null as any)
const req = () => new Request("http://t/api/usage?days=30")

beforeEach(() => vi.clearAllMocks())

describe("GET /api/usage", () => {
  it("401 when unauthenticated", async () => {
    anon()
    const res = await GET(req())
    expect(res.status).toBe(401)
  })

  it("200 returns usage", async () => {
    asUser()
    vi.mocked(getUserUsage).mockResolvedValue({ total: 5 } as any)
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ usage: { total: 5 } })
  })

  it("500 does not leak internal error details to the client", async () => {
    asUser()
    vi.mocked(getUserUsage).mockRejectedValue(new Error("secret db connection string"))
    const res = await GET(req())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ error: "Failed to load usage data." })
    expect(JSON.stringify(body)).not.toContain("secret")
  })
})
