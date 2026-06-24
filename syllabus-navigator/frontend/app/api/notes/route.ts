/**
 * /api/notes — per-user agenda date notes.
 *   GET  /api/notes?date=YYYY-MM-DD  → list the caller's notes for that day
 *   POST /api/notes { note_date, body } → create a note for the caller
 * All access is scoped to the authenticated user (Auth.js session).
 */
import { NextResponse } from "next/server"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { CreateNoteSchema } from "@/lib/server/validators/api.schemas"
import { DateNoteRepository } from "@/lib/server/repositories/date-notes.repo"
import { logError } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: Request) {
  try {
    const { userId } = await requireAuth()
    const params = new URL(req.url).searchParams
    // ?dates=1 → just the distinct days that have notes (for calendar markers).
    if (params.get("dates")) {
      const dates = await DateNoteRepository.listDates(userId)
      return NextResponse.json({ dates })
    }
    const date = params.get("date")
    if (!date || !ISO_DATE.test(date)) {
      return NextResponse.json({ error: "A valid ?date=YYYY-MM-DD is required." }, { status: 400 })
    }
    const notes = await DateNoteRepository.listByDate(userId, date)
    return NextResponse.json({ notes })
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.notes.list_error", { error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: "Failed to load notes." }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const { userId } = await requireAuth()
    const parsed = CreateNoteSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid body" },
        { status: 400 },
      )
    }
    const { note_date, body } = parsed.data
    const note = await DateNoteRepository.create(userId, note_date, body)
    return NextResponse.json({ note }, { status: 201 })
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.notes.create_error", { error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: "Failed to create note." }, { status: 500 })
  }
}
