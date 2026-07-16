/**
 * /api/topics — the user's generated topics grouped by course.
 *   GET /api/topics → { courses: [{ course_id, course_name, course_color, topics: string[] }] }
 * Read-only; powers the "Archivo de temas" section of the Knowledge page.
 * Documents without a course are grouped under course_id: null.
 */
import { NextResponse } from "next/server"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { GraphRepository } from "@/lib/server/repositories/graph.repo"
import { logError } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const { userId } = await requireAuth()
    const rows = await GraphRepository.listUserTopicsByCourse(userId)

    // Fold flat rows into per-course groups, preserving SQL order.
    const groups: {
      course_id: string | null
      course_name: string | null
      course_color: string | null
      topics: string[]
    }[] = []
    const byKey = new Map<string, (typeof groups)[number]>()
    for (const r of rows) {
      const key = r.course_id ?? "__none__"
      let g = byKey.get(key)
      if (!g) {
        g = {
          course_id: r.course_id,
          course_name: r.course_name,
          course_color: r.course_color,
          topics: [],
        }
        byKey.set(key, g)
        groups.push(g)
      }
      g.topics.push(r.label)
    }
    return NextResponse.json({ courses: groups })
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.topics.list_error", { error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: "Failed to load topics." }, { status: 500 })
  }
}
