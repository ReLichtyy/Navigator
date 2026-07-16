import { describe, it, expect, beforeEach, vi } from "vitest"

// Capture the interpolated values of each tagged-template SQL call.
const calls: unknown[][] = []
vi.mock("@/lib/db", () => ({
  sql: (_strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push(values)
    return Promise.resolve([])
  },
}))

import { DateNoteRepository } from "@/lib/server/repositories/date-notes.repo"

beforeEach(() => {
  calls.length = 0
})

describe("DateNoteRepository — every query is scoped to the user", () => {
  it("listByDate filters by user_id and date", async () => {
    await DateNoteRepository.listByDate("user-1", "2026-06-23")
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain("user-1")
    expect(calls[0]).toContain("2026-06-23")
  })

  it("create binds the owner user_id", async () => {
    await DateNoteRepository.create("user-1", "2026-06-23", "hola", {
      title: "Saludo",
      color: "#3FBF84",
    })
    expect(calls[0]).toEqual(["user-1", "2026-06-23", "hola", "Saludo", "#3FBF84"])
  })

  it("update scopes by both note id AND user_id (ownership)", async () => {
    await DateNoteRepository.update("user-1", "note-9", {
      body: "edit",
      title: "Título",
      color: "#D8C79A",
    })
    // values: body, id, userId
    expect(calls[0]).toContain("user-1")
    expect(calls[0]).toContain("note-9")
    expect(calls[0]).toContain("edit")
    expect(calls[0]).toContain("Título")
    expect(calls[0]).toContain("#D8C79A")
  })

  it("remove scopes by both note id AND user_id (ownership)", async () => {
    await DateNoteRepository.remove("user-1", "note-9")
    expect(calls[0]).toContain("user-1")
    expect(calls[0]).toContain("note-9")
  })

  it("update returns null when no row matches (not owned / missing)", async () => {
    const res = await DateNoteRepository.update("user-1", "note-x", { body: "x" })
    expect(res).toBeNull()
  })

  it("remove returns false when no row matches (not owned / missing)", async () => {
    const res = await DateNoteRepository.remove("user-1", "note-x")
    expect(res).toBe(false)
  })

  it("listDates scopes by user_id (calendar markers)", async () => {
    await DateNoteRepository.listDates("user-1")
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain("user-1")
  })
})
