/**
 * /api/notes/[id] — edit or delete a single note the caller owns.
 *   PATCH  { body }  → update; 404 if the note isn't the caller's
 *   DELETE          → delete; 404 if the note isn't the caller's
 * Ownership is enforced in the repository WHERE clause (user_id = session user).
 */
import { NextResponse } from "next/server"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { UpdateNoteSchema } from "@/lib/server/validators/api.schemas"
import { DateNoteRepository } from "@/lib/server/repositories/date-notes.repo"
import { logError } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await requireAuth()
    const { id } = await params
    const parsed = UpdateNoteSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid body" },
        { status: 400 },
      )
    }
    const note = await DateNoteRepository.update(userId, id, parsed.data.body)
    if (!note) return NextResponse.json({ error: "Note not found" }, { status: 404 })
    return NextResponse.json({ note })
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.notes.update_error", { error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: "Failed to update note." }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await requireAuth()
    const { id } = await params
    const ok = await DateNoteRepository.remove(userId, id)
    if (!ok) return NextResponse.json({ error: "Note not found" }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.notes.delete_error", { error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: "Failed to delete note." }, { status: 500 })
  }
}
