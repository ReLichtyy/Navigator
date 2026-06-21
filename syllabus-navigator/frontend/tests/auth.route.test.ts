import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }))
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }))
vi.mock("@/lib/db", () => ({ sql: vi.fn() }))
vi.mock("bcryptjs", () => ({ default: { hash: vi.fn().mockResolvedValue("hashed-pw") } }))

import { checkRateLimit } from "@/lib/rate-limit"
import { sql } from "@/lib/db"
import { POST } from "../app/api/auth/signup/route"

const okRate = () =>
  vi.mocked(checkRateLimit).mockResolvedValue({ success: true, reset: 0, limit: 0, remaining: 0 } as any)
const req = (body: unknown) =>
  new Request("http://t/api/auth/signup", { method: "POST", body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  okRate()
})

describe("POST /api/auth/signup", () => {
  it("429 when rate-limited", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ success: false, reset: Date.now() + 1000, limit: 0, remaining: 0 } as any)
    const res = await POST(req({ email: "a@b.com", password: "secret1" }))
    expect(res.status).toBe(429)
  })

  it("400 when email or password missing", async () => {
    const res = await POST(req({ email: "a@b.com" }))
    expect(res.status).toBe(400)
  })

  it("400 on invalid email format", async () => {
    const res = await POST(req({ email: "not-an-email", password: "secret1" }))
    expect(res.status).toBe(400)
  })

  it("400 on too-short password", async () => {
    const res = await POST(req({ email: "a@b.com", password: "123" }))
    expect(res.status).toBe(400)
  })

  it("409 when email already exists", async () => {
    vi.mocked(sql).mockResolvedValueOnce([{ id: "existing" }] as any)
    const res = await POST(req({ email: "a@b.com", password: "secret1" }))
    expect(res.status).toBe(409)
  })

  it("201 creates user + default preferences", async () => {
    vi.mocked(sql)
      .mockResolvedValueOnce([] as any) // uniqueness check → none
      .mockResolvedValueOnce([{ id: "u1", email: "a@b.com", display_name: "User", role: "free" }] as any) // insert user
      .mockResolvedValueOnce([] as any) // insert prefs
    const res = await POST(req({ email: "A@B.com", password: "secret1" }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.user).toMatchObject({ id: "u1", email: "a@b.com", role: "free" })
    // email normalized to lowercase before the uniqueness query
    expect(vi.mocked(sql).mock.calls[0].slice(1)).toContain("a@b.com")
    expect(vi.mocked(sql)).toHaveBeenCalledTimes(3)
  })
})
