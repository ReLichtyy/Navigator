import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/lib/server/utils/auth-helpers", () => {
  class ApiErrorResponse extends Error {
    status: number
    constructor(message: string, status: number) {
      super(message)
      this.status = status
      this.name = "ApiErrorResponse"
    }
  }
  return {
    requireAuth: vi.fn(),
    getAuthedUser: vi.fn(),
    requireRateLimit: vi.fn(),
    ApiErrorResponse,
  }
})
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }))
vi.mock("@/lib/server/repositories/date-notes.repo", () => ({
  DateNoteRepository: {
    listByDate: vi.fn(),
    listDates: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}))

import { requireAuth, getAuthedUser, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { DateNoteRepository } from "@/lib/server/repositories/date-notes.repo"
import { GET, POST } from "../app/api/notes/route"
import { PATCH, DELETE } from "../app/api/notes/[id]/route"

const asUser = (id = "u1", role = "free") => (
  vi.mocked(requireAuth).mockResolvedValue({ userId: id, role } as any),
  vi.mocked(getAuthedUser).mockResolvedValue({ userId: id, role } as any)
)
const anon = () => (
  vi.mocked(requireAuth).mockRejectedValue(new ApiErrorResponse("Unauthorized", 401)),
  vi.mocked(getAuthedUser).mockResolvedValue(null as any)
)

const getReq = (date?: string) =>
  new Request(`http://t/api/notes${date != null ? `?date=${date}` : ""}`)
const jsonReq = (body: unknown, method = "POST") =>
  new Request("http://t/api/notes", { method, body: JSON.stringify(body) })
const note = (over: Record<string, unknown> = {}) => ({
  id: "n1",
  note_date: "2026-06-23",
  body: "hola",
  created_at: "t",
  updated_at: "t",
  ...over,
})

beforeEach(() => vi.clearAllMocks())

describe("GET /api/notes (read)", () => {
  it("401 when unauthenticated", async () => {
    anon()
    expect((await GET(getReq("2026-06-23"))).status).toBe(401)
  })
  it("400 on missing/invalid date", async () => {
    asUser()
    expect((await GET(getReq())).status).toBe(400)
    expect((await GET(getReq("nope"))).status).toBe(400)
  })
  it("200 returns only the caller's notes for that day", async () => {
    asUser("u1")
    vi.mocked(DateNoteRepository.listByDate).mockResolvedValue([note()] as any)
    const res = await GET(getReq("2026-06-23"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ notes: [note()] })
    // Scoped to the session user — never an id from the request.
    expect(DateNoteRepository.listByDate).toHaveBeenCalledWith("u1", "2026-06-23")
  })
  it("?dates=1 returns the caller's note days (calendar markers), no date required", async () => {
    asUser("u1")
    vi.mocked(DateNoteRepository.listDates).mockResolvedValue(["2026-06-23", "2026-06-25"])
    const res = await GET(new Request("http://t/api/notes?dates=1"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ dates: ["2026-06-23", "2026-06-25"] })
    expect(DateNoteRepository.listDates).toHaveBeenCalledWith("u1")
  })
  it("?dates=1 requires auth", async () => {
    anon()
    expect((await GET(new Request("http://t/api/notes?dates=1"))).status).toBe(401)
  })
})

describe("POST /api/notes (create)", () => {
  it("401 when unauthenticated", async () => {
    anon()
    expect((await POST(jsonReq({ note_date: "2026-06-23", body: "x" }))).status).toBe(401)
  })
  it("400 on empty body or bad date", async () => {
    asUser()
    expect((await POST(jsonReq({ note_date: "2026-06-23", body: "" }))).status).toBe(400)
    expect((await POST(jsonReq({ note_date: "bad", body: "x" }))).status).toBe(400)
  })
  it("201 creates the note for the session user", async () => {
    asUser("u1")
    vi.mocked(DateNoteRepository.create).mockResolvedValue(note() as any)
    const res = await POST(jsonReq({ note_date: "2026-06-23", body: "hola" }))
    expect(res.status).toBe(201)
    expect(DateNoteRepository.create).toHaveBeenCalledWith("u1", "2026-06-23", "hola")
  })
})

describe("PATCH /api/notes/[id] (edit)", () => {
  const ctx = (id = "n1") => ({ params: Promise.resolve({ id }) })
  it("401 when unauthenticated", async () => {
    anon()
    expect((await PATCH(jsonReq({ body: "x" }, "PATCH"), ctx())).status).toBe(401)
  })
  it("404 when the note isn't the caller's (repo returns null)", async () => {
    asUser("u2")
    vi.mocked(DateNoteRepository.update).mockResolvedValue(null)
    const res = await PATCH(jsonReq({ body: "hack" }, "PATCH"), ctx("someone-elses"))
    expect(res.status).toBe(404)
    expect(DateNoteRepository.update).toHaveBeenCalledWith("u2", "someone-elses", "hack")
  })
  it("200 updates the caller's own note", async () => {
    asUser("u1")
    vi.mocked(DateNoteRepository.update).mockResolvedValue(note({ body: "editada" }) as any)
    const res = await PATCH(jsonReq({ body: "editada" }, "PATCH"), ctx("n1"))
    expect(res.status).toBe(200)
    expect((await res.json()).note.body).toBe("editada")
  })
})

describe("DELETE /api/notes/[id] (delete)", () => {
  const ctx = (id = "n1") => ({ params: Promise.resolve({ id }) })
  it("401 when unauthenticated", async () => {
    anon()
    expect((await DELETE(new Request("http://t", { method: "DELETE" }), ctx())).status).toBe(401)
  })
  it("404 when the note isn't the caller's (repo returns false)", async () => {
    asUser("u2")
    vi.mocked(DateNoteRepository.remove).mockResolvedValue(false)
    const res = await DELETE(new Request("http://t", { method: "DELETE" }), ctx("someone-elses"))
    expect(res.status).toBe(404)
    expect(DateNoteRepository.remove).toHaveBeenCalledWith("u2", "someone-elses")
  })
  it("200 deletes the caller's own note", async () => {
    asUser("u1")
    vi.mocked(DateNoteRepository.remove).mockResolvedValue(true)
    const res = await DELETE(new Request("http://t", { method: "DELETE" }), ctx("n1"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
  })
})
