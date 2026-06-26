/**
 * /api/study/quiz-review — the per-user "Repaso" queue of failed quiz questions.
 *   GET   ?kind=doc|course&id=<uuid>     → list open review questions
 *   POST  { kind, id, question }         → record a wrong answer (enters Repaso, leaves quiz)
 *   PATCH { kind, id, question }         → resolve (answered right in Repaso)
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { StudyService } from "@/lib/server/services/study.service"
import type { StudyScope } from "@/lib/server/repositories/study-items.repo"
import { logError } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

const Scope = z.object({ kind: z.enum(["doc", "course"]), id: z.string().uuid() })

const QuestionSchema = z.object({
  question: z.string().min(1),
  options: z.array(z.string()),
  answer: z.number(),
  explanation: z.string().default(""),
  topic: z.string().optional(),
  id: z.string().optional(),
})

const AddBody = Scope.extend({ question: QuestionSchema })
const ResolveBody = Scope.extend({ question: z.string().min(1) })

export async function GET(req: Request) {
  try {
    const { userId } = await requireAuth()
    const sp = new URL(req.url).searchParams
    const parsed = Scope.safeParse({ kind: sp.get("kind"), id: sp.get("id") })
    if (!parsed.success) return NextResponse.json({ error: "Invalid scope." }, { status: 400 })
    const scope: StudyScope = parsed.data
    const questions = await StudyService.listQuizReview(userId, scope)
    return NextResponse.json({ questions })
  } catch (err) {
    return handle(err, "list")
  }
}

export async function POST(req: Request) {
  try {
    const { userId } = await requireAuth()
    const parsed = AddBody.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: "Invalid body." }, { status: 400 })
    const { kind, id, question } = parsed.data
    await StudyService.recordQuizFail(userId, { kind, id }, question)
    return NextResponse.json({ success: true })
  } catch (err) {
    return handle(err, "add")
  }
}

export async function PATCH(req: Request) {
  try {
    const { userId } = await requireAuth()
    const parsed = ResolveBody.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: "Invalid body." }, { status: 400 })
    const { kind, id, question } = parsed.data
    await StudyService.resolveQuizReview(userId, { kind, id }, question)
    return NextResponse.json({ success: true })
  } catch (err) {
    return handle(err, "resolve")
  }
}

function handle(err: unknown, op: string) {
  if (err instanceof ApiErrorResponse) {
    return NextResponse.json({ error: err.message }, { status: err.status })
  }
  logError("api.study.quiz_review_error", { op, error: err instanceof Error ? err.message : String(err) })
  return NextResponse.json({ error: "Failed to update review queue." }, { status: 500 })
}
