import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/lib/auth/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }))
vi.mock("@/lib/cache", () => ({ invalidatePrefix: vi.fn() }))
vi.mock("@/lib/db", () => ({ sql: vi.fn() }))

import { auth } from "@/lib/auth/auth"
import { sql } from "@/lib/db"
import { GET, PATCH } from "../app/api/chat/[chatId]/route"

const params = (chatId: string) => ({ params: Promise.resolve({ chatId }) })
const asUser = (id = "u1") => vi.mocked(auth).mockResolvedValue({ user: { id, role: "free" } } as any)
const anon = () => vi.mocked(auth).mockResolvedValue(null as any)
const jsonReq = (body: unknown) =>
  new Request("http://t/api/chat/c1", { method: "PATCH", body: JSON.stringify(body) })
const CHAT = { id: "c1", title: "T", active_model: "gpt-4o-mini", syllabus_id: null, created_at: "now" }

beforeEach(() => vi.clearAllMocks())

describe("GET /api/chat/[chatId]", () => {
  it("401 when unauthenticated", async () => {
    anon()
    const res = await GET(new Request("http://t/x"), params("c1"))
    expect(res.status).toBe(401)
  })

  it("404 when chat not owned", async () => {
    asUser()
    vi.mocked(sql).mockResolvedValueOnce([] as any) // chat lookup → none
    const res = await GET(new Request("http://t/x"), params("c1"))
    expect(res.status).toBe(404)
  })

  it("200 returns chat with messages + count", async () => {
    asUser()
    vi.mocked(sql)
      .mockResolvedValueOnce([CHAT] as any) // chat
      .mockResolvedValueOnce([{ id: "m1", role: "user", content: "hi", citations: [], created_at: "now" }] as any) // messages
    const res = await GET(new Request("http://t/x"), params("c1"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ id: "c1", message_count: 1 })
    expect(body.messages).toHaveLength(1)
  })
})

describe("PATCH /api/chat/[chatId]", () => {
  it("401 when unauthenticated", async () => {
    anon()
    const res = await PATCH(jsonReq({ title: "new" }), params("c1"))
    expect(res.status).toBe(401)
  })

  it("404 when chat not owned", async () => {
    asUser()
    vi.mocked(sql).mockResolvedValueOnce([] as any) // ownership check → none
    const res = await PATCH(jsonReq({ title: "new" }), params("c1"))
    expect(res.status).toBe(404)
  })

  it("400 when no valid fields to update", async () => {
    asUser()
    vi.mocked(sql).mockResolvedValueOnce([{ id: "c1" }] as any) // ownership ok
    const res = await PATCH(jsonReq({ foo: "bar" }), params("c1"))
    expect(res.status).toBe(400)
  })

  it("200 updates title", async () => {
    asUser()
    vi.mocked(sql)
      .mockResolvedValueOnce([{ id: "c1" }] as any) // ownership ok
      .mockResolvedValueOnce([{ ...CHAT, title: "new" }] as any) // update returning
    const res = await PATCH(jsonReq({ title: "new" }), params("c1"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.title).toBe("new")
  })

  it("200 updates active_model", async () => {
    asUser()
    vi.mocked(sql)
      .mockResolvedValueOnce([{ id: "c1" }] as any)
      .mockResolvedValueOnce([{ ...CHAT, active_model: "gpt-4o" }] as any)
    const res = await PATCH(jsonReq({ active_model: "gpt-4o" }), params("c1"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.active_model).toBe("gpt-4o")
  })
})
