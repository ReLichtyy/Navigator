import { NextResponse } from "next/server"
import { requireAuth, requireRateLimit, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { ChatRepository } from "@/lib/server/repositories/chat.repo"
import { cached, invalidatePrefix } from "@/lib/cache"
import { logError, logInfo } from "@/lib/observability/logger"
import { CreateChatSchema } from "@/lib/server/validators/api.schemas"
import { CourseRepository } from "@/lib/server/repositories/course.repo"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const { userId } = await requireAuth()

    const chats = await cached(`chats:list:${userId}`, 30, async () => {
      return await ChatRepository.listChats(userId)
    })

    return NextResponse.json({ chats })
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.chat.history.list_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to load chats." }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { userId, role } = await requireAuth()

    // Validate request
    const body = await request.json().catch(() => ({}))
    const parsedBody = CreateChatSchema.safeParse(body)
    if (!parsedBody.success) {
      return NextResponse.json({ error: parsedBody.error.issues[0].message }, { status: 400 })
    }

    const syllabusId = parsedBody.data.syllabus_id || null
    const courseId = parsedBody.data.course_id || null

    if (courseId && !(await CourseRepository.findByIdAndUser(courseId, userId))) {
      return NextResponse.json({ error: "Course not found" }, { status: 404 })
    }

    await requireRateLimit(userId, role)

    if (role === "guest") {
      const totalChats = await ChatRepository.countChats(userId)
      if (totalChats >= 3) {
        logInfo("api.chat.history.guest_limit_reached", { userId })
        return NextResponse.json(
          {
            error: "Guest limit reached",
            details: "Guest sessions are limited to 3 chats. Please create an account to continue.",
          },
          { status: 403 },
        )
      }
    }

    const chat = await ChatRepository.createChat(userId, syllabusId, courseId)
    await invalidatePrefix(`chats:list:${userId}`)

    logInfo("api.chat.history.created", { userId, chatId: chat.id })

    return NextResponse.json(chat)
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.chat.history.create_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to create chat." }, { status: 500 })
  }
}
